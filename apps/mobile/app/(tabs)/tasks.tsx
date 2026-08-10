/**
 * Tasks page — project list with task counts, expandable to show tasks.
 * Includes task creation (FAB + inline input) and status toggling.
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
} from 'react-native';
import { useDataProvider } from '../../services/provider-context';
import { fullSync } from '../../services/sync';
import type { Project, LocalTask, TaskStatus, Label } from '@nimble/types';
import { colors, spacing, fontSize } from '../../constants/theme';
import { labelColor } from '../../constants/labelColors';

const priorityColors: Record<number, string> = {
  1: colors.priority1,
  2: colors.priority2,
  3: colors.priority3,
  4: colors.priority4,
};

const statusIcons: Record<string, string> = {
  backlog: '○',
  todo: '◎',
  in_progress: '◉',
  blocked: '⊘',
  complete: '●',
};

const STATUS_CYCLE: Record<string, TaskStatus> = {
  backlog: 'todo',
  todo: 'in_progress',
  in_progress: 'complete',
  blocked: 'todo',
};

interface ProjectWithTasks extends Project {
  tasks: LocalTask[];
}

export default function TasksPage() {
  const dp = useDataProvider();
  const [projects, setProjects] = useState<ProjectWithTasks[]>([]);
  const [labelsById, setLabelsById] = useState<Map<string, Label>>(new Map());
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newTaskContent, setNewTaskContent] = useState('');
  const [creating, setCreating] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [projectList, labelList] = await Promise.all([
        dp.projects.list(),
        dp.labels.list(),
      ]);
      const withTasks: ProjectWithTasks[] = [];

      for (const p of projectList) {
        const tasks = await dp.tasks.list({
          projectId: p.id,
          includeCompleted: false,
        });
        withTasks.push({ ...p, tasks });
      }

      setProjects(withTasks);
      setLabelsById(new Map(labelList.map((l) => [l.id, l])));
    } catch (e) {
      console.error('Failed to load projects:', e);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [dp]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await fullSync();
    } catch (e) {
      console.warn('[tasks] Sync on refresh failed:', e);
    }
    loadData();
  }, [loadData]);

  const toggleProject = useCallback(
    (id: string) => {
      setExpandedId((prev) => (prev === id ? null : id));
    },
    []
  );

  const toggleTaskStatus = useCallback(
    async (task: LocalTask) => {
      try {
        const nextStatus = STATUS_CYCLE[task.status] || 'complete';
        await dp.tasks.updateStatus(task.id, nextStatus);
        loadData();
      } catch (e) {
        console.error('Failed to update task status:', e);
      }
    },
    [dp, loadData]
  );

  const createTask = useCallback(async () => {
    const content = newTaskContent.trim();
    if (!content || creating) return;

    setCreating(true);
    try {
      await dp.tasks.create({ content, projectId: 'inbox' });
      setNewTaskContent('');
      setShowCreate(false);
      loadData();
    } catch (e) {
      console.error('Failed to create task:', e);
    } finally {
      setCreating(false);
    }
  }, [dp, newTaskContent, creating, loadData]);

  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.center}>
          <Text style={styles.loadingText}>Loading projects...</Text>
        </View>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Create task input */}
      {showCreate && (
        <View style={styles.createBar}>
          <TextInput
            style={styles.createInput}
            placeholder="What needs doing?"
            placeholderTextColor={colors.textMuted}
            value={newTaskContent}
            onChangeText={setNewTaskContent}
            onSubmitEditing={createTask}
            returnKeyType="done"
            autoFocus
          />
          <TouchableOpacity
            style={[styles.createSubmit, !newTaskContent.trim() && styles.createSubmitDisabled]}
            onPress={createTask}
            disabled={!newTaskContent.trim() || creating}
          >
            <Text style={styles.createSubmitText}>
              {creating ? '...' : 'Add'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      <FlatList
        data={projects}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item: project }) => (
          <View style={styles.projectCard}>
            <TouchableOpacity
              style={styles.projectHeader}
              onPress={() => toggleProject(project.id)}
              activeOpacity={0.7}
            >
              <View style={styles.projectLeft}>
                <View
                  style={[styles.colorDot, { backgroundColor: project.color }]}
                />
                <Text style={styles.projectName}>{project.name}</Text>
              </View>
              <Text style={styles.taskCount}>
                {project.tasks.length}{' '}
                {project.tasks.length === 1 ? 'task' : 'tasks'}
              </Text>
            </TouchableOpacity>

            {expandedId === project.id && project.tasks.length > 0 && (
              <View style={styles.taskList}>
                {project.tasks.map((task) => (
                  <TouchableOpacity
                    key={task.id}
                    style={styles.taskRow}
                    onPress={() => toggleTaskStatus(task)}
                    activeOpacity={0.7}
                  >
                    <Text
                      style={[
                        styles.statusIcon,
                        {
                          color:
                            priorityColors[task.priority] || colors.priority1,
                        },
                      ]}
                    >
                      {statusIcons[task.status] || '○'}
                    </Text>
                    <View style={styles.taskContent}>
                      <Text style={styles.taskText} numberOfLines={2}>
                        {task.content}
                      </Text>
                      <View style={styles.taskMetaRow}>
                        <Text style={styles.taskStatusLabel}>
                          {task.status.replace('_', ' ')}
                        </Text>
                        {task.due_date && (
                          <Text style={styles.taskMeta}>
                            {task.due_date}
                            {task.due_time ? ` · ${task.due_time}` : ''}
                          </Text>
                        )}
                        {task.recurrence_rule && (
                          <Text
                            style={styles.recurrenceGlyph}
                            accessibilityLabel="Recurring task"
                          >
                            ↻
                          </Text>
                        )}
                      </View>
                      {task.labels.length > 0 && (
                        <View style={styles.taskLabelsRow}>
                          {task.labels.map((labelId) => {
                            const label = labelsById.get(labelId);
                            if (!label) return null;
                            return (
                              <View key={labelId} style={styles.labelChip}>
                                <View
                                  style={[
                                    styles.labelDot,
                                    { backgroundColor: labelColor(label.color) },
                                  ]}
                                />
                                <Text style={styles.labelChipText} numberOfLines={1}>
                                  {label.name}
                                </Text>
                              </View>
                            );
                          })}
                        </View>
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            {expandedId === project.id && project.tasks.length === 0 && (
              <View style={styles.emptyProject}>
                <Text style={styles.emptyText}>No open tasks</Text>
              </View>
            )}
          </View>
        )}
        ListEmptyComponent={
          <View style={styles.center}>
            <Text style={styles.emptyText}>No projects yet</Text>
          </View>
        }
      />

      {/* FAB for creating tasks */}
      {!showCreate && (
        <TouchableOpacity
          style={styles.fab}
          onPress={() => setShowCreate(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.fabText}>+</Text>
        </TouchableOpacity>
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
    paddingVertical: spacing.xl * 2,
  },
  // Create bar
  createBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.bgCard,
    borderBottomWidth: 0.5,
    borderBottomColor: colors.border,
    gap: spacing.sm,
  },
  createInput: {
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
  createSubmit: {
    backgroundColor: colors.accent,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  createSubmitDisabled: {
    opacity: 0.4,
  },
  createSubmitText: {
    color: '#000',
    fontWeight: '600',
    fontSize: fontSize.md,
  },
  // List
  list: {
    padding: spacing.md,
    gap: spacing.sm,
  },
  projectCard: {
    backgroundColor: colors.bgCard,
    borderRadius: 10,
    overflow: 'hidden',
  },
  projectHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.md,
  },
  projectLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  colorDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginRight: 10,
  },
  projectName: {
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.text,
  },
  taskCount: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
  },
  taskList: {
    borderTopWidth: 0.5,
    borderTopColor: colors.border,
    paddingBottom: spacing.xs,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
  },
  statusIcon: {
    fontSize: 14,
    marginRight: 10,
    marginTop: 2,
    width: 18,
  },
  taskContent: {
    flex: 1,
  },
  taskText: {
    fontSize: fontSize.md,
    color: colors.text,
    lineHeight: 20,
  },
  taskMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 2,
  },
  taskStatusLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  taskMeta: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  recurrenceGlyph: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  taskLabelsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  labelChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    backgroundColor: colors.bgSurface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 3,
    maxWidth: 140,
  },
  labelDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  labelChipText: {
    fontSize: fontSize.xs,
    color: colors.textSecondary,
    flexShrink: 1,
  },
  loadingText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: fontSize.sm,
  },
  emptyProject: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  // FAB
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    justifyContent: 'center',
    alignItems: 'center',
    // Shadow
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 5,
  },
  fabText: {
    fontSize: 28,
    color: '#000',
    fontWeight: '600',
    lineHeight: 30,
  },
});
