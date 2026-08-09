/**
 * Today page — greeting, today's tasks with completion toggle, habits with tap-to-log.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  RefreshControl,
} from 'react-native';
import { useDataProvider } from '../../services/provider-context';
import { fullSync } from '../../services/sync';
import type { LocalTask, HabitWithStats } from '@nimble/types';
import { colors, spacing, fontSize } from '../../constants/theme';

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

const priorityColors: Record<number, string> = {
  1: colors.priority1,
  2: colors.priority2,
  3: colors.priority3,
  4: colors.priority4,
};

const STATUS_CYCLE: Record<string, string> = {
  todo: 'in_progress',
  in_progress: 'complete',
  backlog: 'todo',
  blocked: 'todo',
};

const statusIcons: Record<string, string> = {
  backlog: '○',
  todo: '◎',
  in_progress: '◉',
  blocked: '⊘',
  complete: '●',
};

export default function TodayPage() {
  const dp = useDataProvider();
  const [tasks, setTasks] = useState<LocalTask[]>([]);
  const [habits, setHabits] = useState<HabitWithStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [allTasks, allHabits] = await Promise.all([
        dp.tasks.list({ includeCompleted: false }),
        dp.habits.list(),
      ]);
      setTasks(allTasks);
      setHabits(allHabits);
    } catch (e) {
      console.error('Failed to load data:', e);
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
      console.warn('[today] Sync on refresh failed:', e);
    }
    loadData();
  }, [loadData]);

  const toggleTaskStatus = useCallback(
    async (task: LocalTask) => {
      try {
        if (task.status === 'complete') {
          await dp.tasks.uncomplete(task.id);
        } else {
          const nextStatus = STATUS_CYCLE[task.status] || 'complete';
          await dp.tasks.updateStatus(task.id, nextStatus as LocalTask['status']);
        }
        // Reload after mutation
        const updated = await dp.tasks.list({ includeCompleted: false });
        setTasks(updated);
      } catch (e) {
        console.error('Failed to toggle task:', e);
      }
    },
    [dp]
  );

  const toggleHabit = useCallback(
    async (habit: HabitWithStats) => {
      try {
        if (habit.today_completed) {
          await dp.habits.unlog(habit.id);
        } else {
          await dp.habits.log(habit.id);
        }
        const updated = await dp.habits.list();
        setHabits(updated);
      } catch (e) {
        console.error('Failed to toggle habit:', e);
      }
    },
    [dp]
  );

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.contentContainer}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
    >
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.greeting}>{getGreeting()}</Text>
        <Text style={styles.date}>{today}</Text>
      </View>

      {/* Habits Section */}
      {habits.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Habits</Text>
          <View style={styles.habitsRow}>
            {habits.map((habit) => (
              <TouchableOpacity
                key={habit.id}
                style={[
                  styles.habitChip,
                  habit.today_completed && styles.habitChipDone,
                ]}
                onPress={() => toggleHabit(habit)}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.habitName,
                    habit.today_completed && styles.habitNameDone,
                  ]}
                >
                  {habit.name}
                </Text>
                {habit.current_momentum > 0 && (
                  <Text style={styles.habitMomentum}>
                    {habit.current_momentum}/7
                  </Text>
                )}
              </TouchableOpacity>
            ))}
          </View>
        </View>
      )}

      {/* Tasks Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          Open tasks{' '}
          <Text style={styles.count}>({tasks.length})</Text>
        </Text>

        {loading ? (
          <View style={styles.placeholder}>
            <Text style={styles.placeholderText}>Loading tasks...</Text>
          </View>
        ) : tasks.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyText}>Nothing here yet</Text>
            <Text style={styles.emptySubtext}>
              Tasks will appear once synced from desktop
            </Text>
          </View>
        ) : (
          tasks.map((task) => (
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
                <Text style={styles.taskText} numberOfLines={1}>
                  {task.content}
                </Text>
                <View style={styles.taskMetaRow}>
                  <Text style={styles.taskStatus}>{task.status.replace('_', ' ')}</Text>
                  {task.due_date && (
                    <Text style={styles.taskMeta}>{task.due_date}</Text>
                  )}
                </View>
              </View>
            </TouchableOpacity>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  contentContainer: {
    paddingBottom: spacing.xl,
  },
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  greeting: {
    fontSize: fontSize.title,
    fontWeight: '700',
    color: colors.text,
  },
  date: {
    fontSize: fontSize.md,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },
  section: {
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  sectionTitle: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  count: {
    color: colors.textMuted,
    fontWeight: '400',
  },
  // Habits
  habitsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  habitChip: {
    backgroundColor: colors.bgCard,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  habitChipDone: {
    backgroundColor: colors.accentMuted,
    borderColor: colors.accent,
  },
  habitName: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: '500',
  },
  habitNameDone: {
    color: colors.accent,
  },
  habitMomentum: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  // Tasks
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bgCard,
    borderRadius: 8,
    marginBottom: spacing.xs,
  },
  statusIcon: {
    fontSize: 16,
    marginRight: 12,
    width: 20,
    textAlign: 'center',
  },
  taskContent: {
    flex: 1,
  },
  taskText: {
    fontSize: fontSize.md,
    color: colors.text,
  },
  taskMetaRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: 2,
  },
  taskStatus: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    textTransform: 'capitalize',
  },
  taskMeta: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
  placeholder: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
  },
  placeholderText: {
    color: colors.textMuted,
    fontSize: fontSize.md,
  },
  emptyState: {
    paddingVertical: spacing.xl * 2,
    alignItems: 'center',
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
