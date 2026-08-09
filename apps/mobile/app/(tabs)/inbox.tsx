/**
 * Inbox page — list of captures with quick capture input.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  RefreshControl,
  Alert,
} from 'react-native';
import { useDataProvider } from '../../services/provider-context';
import type { Capture } from '@nimble/types';
import { colors, spacing, fontSize } from '../../constants/theme';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export default function InboxPage() {
  const dp = useDataProvider();
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const items = await dp.captures.list(50);
      setCaptures(items);
    } catch (e) {
      console.error('Failed to load captures:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dp]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadData();
  }, [loadData]);

  const saveCapture = useCallback(async () => {
    const content = inputValue.trim();
    if (!content || saving) return;

    setSaving(true);
    try {
      await dp.captures.create(content, 'mobile');
      setInputValue('');
      loadData();
    } catch (e) {
      console.error('Failed to save capture:', e);
    } finally {
      setSaving(false);
    }
  }, [dp, inputValue, saving, loadData]);

  const deleteCapture = useCallback(
    (capture: Capture) => {
      Alert.alert(
        'Delete capture?',
        capture.content.slice(0, 60) + (capture.content.length > 60 ? '...' : ''),
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Delete',
            style: 'destructive',
            onPress: async () => {
              try {
                await dp.captures.delete(capture.id);
                loadData();
              } catch (e) {
                console.error('Failed to delete capture:', e);
              }
            },
          },
        ]
      );
    },
    [dp, loadData]
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Quick capture input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.input}
          placeholder="Quick capture..."
          placeholderTextColor={colors.textMuted}
          value={inputValue}
          onChangeText={setInputValue}
          onSubmitEditing={saveCapture}
          returnKeyType="done"
          multiline={false}
        />
        <TouchableOpacity
          style={[styles.saveButton, !inputValue.trim() && styles.saveButtonDisabled]}
          onPress={saveCapture}
          disabled={!inputValue.trim() || saving}
        >
          <Text style={styles.saveButtonText}>
            {saving ? '...' : 'Save'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Captures list */}
      {loading ? (
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading captures...</Text>
        </View>
      ) : captures.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>Inbox is empty</Text>
          <Text style={styles.emptySubtext}>
            Type above to capture a thought
          </Text>
        </View>
      ) : (
        <FlatList
          data={captures}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.accent}
            />
          }
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.captureCard}
              onLongPress={() => deleteCapture(item)}
              activeOpacity={0.8}
            >
              <Text style={styles.captureContent}>{item.content}</Text>
              <View style={styles.captureMeta}>
                <Text style={styles.timestamp}>
                  {formatTimestamp(item.created_at)}
                </Text>
                {item.source !== 'manual' && (
                  <View style={styles.sourceBadge}>
                    <Text style={styles.sourceText}>{item.source}</Text>
                  </View>
                )}
                {item.routed_to && (
                  <View style={styles.routeBadge}>
                    <Text style={styles.routeText}>{item.routed_to}</Text>
                  </View>
                )}
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Input bar
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    height: 40,
    backgroundColor: colors.bgSurface,
    borderRadius: 8,
    paddingHorizontal: 12,
    color: colors.text,
    fontSize: fontSize.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  saveButton: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveButtonText: {
    color: '#000',
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  // List
  list: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  captureCard: {
    backgroundColor: colors.bgCard,
    borderRadius: 10,
    padding: spacing.md,
  },
  captureContent: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 22,
  },
  captureMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  timestamp: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  sourceBadge: {
    backgroundColor: colors.bgHover,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  sourceText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
  },
  routeBadge: {
    backgroundColor: colors.accentMuted,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  routeText: {
    fontSize: fontSize.xs,
    color: colors.accent,
    fontWeight: '500',
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  emptyText: {
    color: colors.textSecondary,
    fontSize: fontSize.lg,
    fontWeight: '500',
  },
  emptySubtext: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
    marginTop: spacing.xs,
  },
});
