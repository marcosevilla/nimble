use crate::focus_types::FocusEntry;
use std::collections::HashSet;

pub fn validate(entries: &[FocusEntry], selected: Option<&str>) -> crate::Result<()> {
    let mut ids = HashSet::new();
    let mut occurrences = HashSet::new();
    for e in entries {
        if !ids.insert(&e.id) || !occurrences.insert(&e.occurrence_id) {
            return Err(crate::Error::Other(
                "invalid: duplicate focus queue membership".into(),
            ));
        }
        super::schema::validate_config(&e.config)?;
    }
    if selected.is_some_and(|id| !occurrences.contains(&id.to_string())) {
        return Err(crate::Error::Other(
            "invalid: selected occurrence is not queued".into(),
        ));
    }
    Ok(())
}

pub fn move_to_front(entries: &mut Vec<FocusEntry>, occurrence: &str) -> bool {
    let Some(index) = entries.iter().position(|e| e.occurrence_id == occurrence) else {
        return false;
    };
    if index == 0 {
        return false;
    }
    let item = entries.remove(index);
    entries.insert(0, item);
    true
}
