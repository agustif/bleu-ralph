import { For } from "solid-js";
import { colors } from "./colors";
import type { Task } from "../plan";

export type TasksPanelProps = {
  tasks: Task[];
  onClose: () => void;
};

/**
 * Tasks panel overlay displaying all tasks from the plan file.
 * Shows completion status (checkbox) and task text with line numbers.
 */
export function TasksPanel(props: TasksPanelProps) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      backgroundColor="rgba(0, 0, 0, 0.8)"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <box
        backgroundColor={colors.bgDark}
        borderColor={colors.cyan}
        borderStyle="single"
        padding={1}
        paddingLeft={2}
        paddingRight={2}
        flexDirection="column"
        width={80}
        height={40}
      >
        <box
          width="100%"
          flexDirection="row"
          marginBottom={1}
          paddingBottom={1}
          border={["bottom"]}
          borderColor={colors.border}
          borderStyle="single"
        >
          <text fg={colors.cyan}>Plan Tasks</text>
          <text flexGrow={1} />
          <text fg={colors.fgMuted}>{props.tasks.length} tasks</text>
        </box>

        <scrollbox
          flexGrow={1}
          rootOptions={{
            backgroundColor: colors.bg,
          }}
          viewportOptions={{
            backgroundColor: colors.bgDark,
          }}
          verticalScrollbarOptions={{
            visible: true,
            trackOptions: {
              backgroundColor: colors.border,
            },
          }}
        >
          <For each={props.tasks}>
            {(task) => (
              <box width="100%" flexDirection="row" paddingLeft={1}>
                <text fg={task.done ? colors.green : colors.fgMuted}>
                  {task.done ? "[✓]" : "[ ]"}
                </text>
                <text fg={task.done ? colors.fgMuted : colors.fg} paddingLeft={1}>
                  {task.text}
                </text>
              </box>
            )}
          </For>
        </scrollbox>

        <box
          width="100%"
          flexDirection="row"
          marginTop={1}
          paddingTop={1}
          border={["top"]}
          borderColor={colors.border}
          borderStyle="single"
        >
          <text fg={colors.fgMuted}>ESC: close</text>
        </box>
      </box>
    </box>
  );
}
