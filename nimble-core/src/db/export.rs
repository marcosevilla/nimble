//! Canonical v19 export of user-owned records and private full-snapshot comparison.
use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Number, Value};
use sqlx::{Column, Row, Sqlite, SqlitePool, Transaction, TypeInfo, ValueRef};

use super::export_policy::{TablePolicy, FTS_TABLES, TABLES};

pub struct PortableExport {
    pub data: Vec<u8>,
    pub format: Vec<u8>,
}

fn invalid(message: &str) -> crate::Error {
    crate::Error::Other(format!("backup_export_{message}"))
}

fn quoted(identifier: &str) -> String {
    // Only compile-time policy names enter this function.
    format!("\"{identifier}\"")
}

fn json_bytes<T: serde::Serialize>(value: &T) -> crate::Result<Vec<u8>> {
    let mut bytes = serde_json::to_vec_pretty(value).map_err(|_| invalid("serialize"))?;
    bytes.push(b'\n');
    Ok(bytes)
}

async fn columns(
    tx: &mut Transaction<'_, Sqlite>,
    table: &str,
) -> crate::Result<Vec<(String, i64)>> {
    let query = format!("PRAGMA table_info({})", quoted(table));
    let rows = sqlx::query(&query).fetch_all(&mut **tx).await?;
    Ok(rows
        .into_iter()
        .map(|row| Ok((row.try_get("name")?, row.try_get("pk")?)))
        .collect::<std::result::Result<_, sqlx::Error>>()?)
}

async fn validate(tx: &mut Transaction<'_, Sqlite>) -> crate::Result<()> {
    let version: Option<i64> = sqlx::query_scalar("SELECT MAX(version) FROM schema_version")
        .fetch_one(&mut **tx)
        .await?;
    if version != Some(19) {
        return Err(invalid("unsupported_schema"));
    }
    let rows = sqlx::query("SELECT name FROM sqlite_master WHERE type IN ('table','view')")
        .fetch_all(&mut **tx)
        .await?;
    let actual: BTreeSet<String> = rows
        .into_iter()
        .map(|row| row.try_get("name"))
        .collect::<std::result::Result<BTreeSet<String>, sqlx::Error>>()?
        .into_iter()
        .filter(|name| !name.starts_with("sqlite_"))
        .collect();
    let expected: BTreeSet<String> = TABLES
        .iter()
        .map(|p| p.name.to_owned())
        .chain(FTS_TABLES.iter().map(|(name, _)| (*name).to_owned()))
        .collect();
    if actual != expected {
        return Err(invalid("table_drift"));
    }
    for policy in TABLES {
        let discovered = columns(tx, policy.name).await?;
        let found: BTreeSet<String> = discovered.iter().map(|(name, _)| name.clone()).collect();
        let reviewed: BTreeSet<String> = policy.columns.iter().map(|s| (*s).to_owned()).collect();
        if found != reviewed {
            return Err(invalid("column_drift"));
        }
        if !policy.included.iter().all(|name| reviewed.contains(*name)) {
            return Err(invalid("invalid_policy"));
        }
        let mut actual_pk: Vec<(i64, &str)> = discovered
            .iter()
            .filter_map(|(name, ordinal)| (*ordinal > 0).then_some((*ordinal, name.as_str())))
            .collect();
        actual_pk.sort_by_key(|(ordinal, _)| *ordinal);
        let expected_pk: Vec<(i64, &str)> = policy
            .primary_key
            .iter()
            .enumerate()
            .map(|(index, name)| ((index + 1) as i64, *name))
            .collect();
        if actual_pk != expected_pk {
            return Err(invalid("primary_key_drift"));
        }
    }
    // FTS is excluded, but its virtual and shadow schemas must still match v19.
    for (name, reviewed) in FTS_TABLES {
        let found: BTreeSet<String> = columns(tx, name)
            .await?
            .into_iter()
            .map(|(column, _)| column)
            .collect();
        let expected: BTreeSet<String> =
            reviewed.iter().map(|column| (*column).to_owned()).collect();
        if found != expected {
            return Err(invalid("fts_drift"));
        }
    }
    Ok(())
}

pub async fn validate_schema(pool: &SqlitePool) -> crate::Result<()> {
    let mut tx = pool.begin().await?;
    validate(&mut tx).await
}

fn cell(
    row: &sqlx::sqlite::SqliteRow,
    index: usize,
    private_comparison: bool,
) -> crate::Result<Value> {
    let raw = row.try_get_raw(index)?;
    if raw.is_null() {
        return Ok(Value::Null);
    }
    match raw.type_info().name() {
        "INTEGER" => Ok(Value::Number(Number::from(row.try_get::<i64, _>(index)?))),
        "REAL" => {
            let value: f64 = row.try_get(index)?;
            Number::from_f64(value)
                .map(Value::Number)
                .ok_or_else(|| invalid("non_finite_real"))
        }
        "TEXT" => Ok(Value::String(row.try_get::<String, _>(index)?)),
        "BLOB" if private_comparison => {
            let bytes: Vec<u8> = row.try_get(index)?;
            Ok(Value::Array(
                bytes
                    .into_iter()
                    .map(|b| Value::Number(Number::from(b)))
                    .collect(),
            ))
        }
        _ => Err(invalid("unsupported_storage_type")),
    }
}

async fn records(
    tx: &mut Transaction<'_, Sqlite>,
    policy: &TablePolicy,
    included: bool,
) -> crate::Result<Vec<Value>> {
    let selected = if included {
        policy.included
    } else {
        policy.columns
    };
    if selected.is_empty() {
        return Ok(Vec::new());
    }
    let select = selected
        .iter()
        .map(|name| quoted(name))
        .collect::<Vec<_>>()
        .join(",");
    let order = policy
        .primary_key
        .iter()
        .map(|name| quoted(name))
        .collect::<Vec<_>>()
        .join(",");
    let query = format!(
        "SELECT {select} FROM {} ORDER BY {order}",
        quoted(policy.name)
    );
    let rows = sqlx::query(&query).fetch_all(&mut **tx).await?;
    rows.iter()
        .map(|row| {
            let mut map = Map::new();
            for (index, name) in selected.iter().enumerate() {
                if row.columns()[index].name() != *name {
                    return Err(invalid("column_order"));
                }
                map.insert((*name).to_owned(), cell(row, index, !included)?);
            }
            Ok(Value::Object(map))
        })
        .collect()
}

pub async fn export_portable(pool: &SqlitePool) -> crate::Result<PortableExport> {
    let mut tx = pool.begin().await?;
    validate(&mut tx).await?;
    let mut data = BTreeMap::<String, Vec<Value>>::new();
    let mut included = BTreeMap::<String, Vec<&str>>::new();
    let mut excluded = BTreeMap::<String, Vec<&str>>::new();
    for policy in TABLES {
        if policy.included.is_empty() {
            let mut names = policy.columns.to_vec();
            names.sort_unstable();
            excluded.insert(policy.name.to_owned(), names);
        } else {
            data.insert(
                policy.name.to_owned(),
                records(&mut tx, policy, true).await?,
            );
            let mut names = policy.included.to_vec();
            names.sort_unstable();
            included.insert(policy.name.to_owned(), names);
            let mut omitted: Vec<&str> = policy
                .columns
                .iter()
                .copied()
                .filter(|column| !policy.included.contains(column))
                .collect();
            omitted.sort_unstable();
            if !omitted.is_empty() {
                excluded.insert(policy.name.to_owned(), omitted);
            }
        }
    }
    for (name, columns) in FTS_TABLES {
        let mut names = columns.to_vec();
        names.sort_unstable();
        excluded.insert((*name).to_owned(), names);
    }
    let format = serde_json::json!({
        "export_version": 1,
        "schema_version": 19,
        "included": included,
        "excluded": excluded,
    });
    Ok(PortableExport {
        data: json_bytes(&data)?,
        format: json_bytes(&format)?,
    })
}

/// Compare all ordinary SQLite application tables, including private local state.
/// The resulting boolean is safe to report; row contents are never logged.
pub async fn compare_snapshot_tables(a: &SqlitePool, b: &SqlitePool) -> crate::Result<bool> {
    let mut left = a.begin().await?;
    let mut right = b.begin().await?;
    validate(&mut left).await?;
    validate(&mut right).await?;
    for policy in TABLES {
        if records(&mut left, policy, false).await? != records(&mut right, policy, false).await? {
            return Ok(false);
        }
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn real_two_and_integer_two_remain_distinct() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let row = sqlx::query("SELECT CAST(2.0 AS REAL) AS real_value, 2 AS integer_value")
            .fetch_one(&pool)
            .await
            .unwrap();
        let real = cell(&row, 0, false).unwrap();
        let integer = cell(&row, 1, false).unwrap();
        assert_eq!(real.as_f64(), Some(2.0));
        assert_eq!(integer.as_i64(), Some(2));
        assert_ne!(real, integer);
        assert_eq!(serde_json::to_string(&real).unwrap(), "2.0");
        assert_eq!(serde_json::to_string(&integer).unwrap(), "2");
        pool.close().await;
    }
}
