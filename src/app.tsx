import { render, useKeyboard, useRenderer } from "@opentui/solid";
import type { KeyEvent } from "@opentui/core";
import { createSignal, onCleanup, Setter, Show, For, createMemo } from "solid-js";
import { Header } from "./components/header";
import { Log } from "./components/log";
import { Footer } from "./components/footer";
import { PausedOverlay } from "./components/paused";
import { TasksPanel } from "./components/tasks";
import type { LoopState, LoopOptions, PersistedState } from "./state";
import { colors } from "./components/colors";
import { calculateEta } from "./util/time";
import { log } from "./util/log";
import { parsePlan, type Task } from "./plan";

/**
 * Error overlay component for displaying errors
 */
function ErrorOverlay(props: { error: string; onDismiss: () => void }) {
  return (
    <box
      position="absolute"
      top={0}
      left={0}
      right={0}
      bottom={0}
      backgroundColor="rgba(0, 0, 0, 0.95)"
      flexDirection="column"
      justifyContent="center"
      alignItems="center"
    >
      <box
        backgroundColor={colors.bgDark}
        borderColor={colors.red}
        borderStyle="single"
        padding={2}
        paddingLeft={3}
        paddingRight={3}
        flexDirection="column"
        width={80}
        height={15}
      >
        <box
          width="100%"
          flexDirection="row"
          marginBottom={1}
          paddingBottom={1}
          border={["bottom"]}
          borderColor={colors.red}
          borderStyle="single"
        >
          <text style={{ fg: colors.red }}>⚠ Error</text>
          <text flexGrow={1} />
          <text style={{ fg: colors.fgMuted }}>Press any key to dismiss</text>
        </box>

        <box
          flexGrow={1}
          flexDirection="column"
          justifyContent="center"
        >
          <text style={{ fg: colors.fg }}>
            {props.error}
          </text>
        </box>

        <box
          width="100%"
          flexDirection="row"
          marginTop={1}
          paddingTop={1}
          border={["top"]}
          borderColor={colors.red}
          borderStyle="single"
        >
          <text style={{ fg: colors.fgMuted }}>
            Ralph encountered an error and will retry automatically
          </text>
        </box>
      </box>
    </box>
  );
}

type AppProps = {
  options: LoopOptions;
  persistedState: PersistedState;
  onQuit: () => void;
  iterationTimesRef?: number[];
  onKeyboardEvent?: () => void;
  onSessionCreated?: (sessionId: string, sendMessage: (message: string) => Promise<void>) => void;
  onSessionEnded?: () => void;
  onSessionsList?: (sessions: Array<{ id: string; created: string }>) => void;
  onSwitchSession?: (sessionId: string) => void;
  setSendMessageRef?: (setter: (fn: ((msg: string) => Promise<void>) | null) => void) => void;
  onStateSettersReady?: (setters: AppStateSetters) => void;
};

/**
 * State setters returned from startApp to allow external state updates.
 */
export type AppStateSetters = {
  setState: Setter<LoopState>;
  updateIterationTimes: (times: number[]) => void;
  onSessionCreated: (sessionId: string, sendMessage: (message: string) => Promise<void>) => void;
  onSessionEnded: () => void;
  onSessionsList: (sessions: Array<{ id: string; created: string }>) => void;
  onSwitchSession: (sessionId: string) => void;
};

/**
 * Result of starting the app - contains both the exit promise and state setters.
 */
export type StartAppResult = {
  exitPromise: Promise<void>;
  stateSetters: AppStateSetters;
};

// Module-level state setters that will be populated when App renders
let globalSetState: Setter<LoopState> | null = null;
let globalUpdateIterationTimes: ((times: number[]) => void) | null = null;
let globalOnSessionCreated: ((sessionId: string, sendMessage: (message: string) => Promise<void>) => void) | null = null;
let globalOnSessionEnded: (() => void) | null = null;
let globalOnSessionsList: ((sessions: Array<{ id: string; created: string }>) => void) | null = null;
let globalOnSwitchSession: ((sessionId: string) => void) | null = null;

export type SendMessageSetter = Setter<((message: string) => Promise<void>) | null>;

export function App(props: AppProps) {
  log("app", "App component starting");
  
  // Get renderer for cleanup on quit
  const renderer = useRenderer();
  log("app", "Renderer obtained");

  // Signal for sendMessage function (for sending steering messages)
  const [sendMessage, setSendMessage] = createSignal<((message: string) => Promise<void>) | null>(null);

  // Signal for command mode state
  const [commandMode, setCommandMode] = createSignal(false);
  const [commandInput, setCommandInput] = createSignal("");

  // Signal for tasks panel
  const [showTasks, setShowTasks] = createSignal(false);
  const [tasks, setTasks] = createSignal<Task[]>([]);

  // Signal for sessions list
  const [sessions, setSessions] = createSignal<Array<{ id: string; created: string }>>([]);

  // Signal for error display
  const [errorMessage, setErrorMessage] = createSignal<string | null>(null);
  const [showError, setShowError] = createSignal(false);

  // Expose setter to parent
  if (props.setSendMessageRef) {
    props.setSendMessageRef(setSendMessage);
  }

  // Load tasks from plan file
  parsePlan(props.options.planFile).then((data) => {
    log("app", "Tasks loaded", { count: data.tasks.length, done: data.done, total: data.total });
    setTasks(data.tasks);
  });
  
  // Disable stdout interception to prevent OpenTUI from capturing stdout
  // which may interfere with logging and other output (matches OpenCode pattern).
  renderer.disableStdoutInterception();
  log("app", "Stdout interception disabled");
  
  // State signal for loop state
  // Initialize iteration to length + 1 since we're about to start the next iteration
  const [state, setState] = createSignal<LoopState>({
    status: "starting",
    iteration: props.persistedState.iterationTimes.length + 1,
    tasksComplete: 0,
    totalTasks: 0,
    commits: 0,
    linesAdded: 0,
    linesRemoved: 0,
    events: [],
    isIdle: true, // Starts idle, waiting for first LLM response
  });
  log("app", "State signal created");

  // Signal to track iteration times (for ETA calculation)
  const [iterationTimes, setIterationTimes] = createSignal<number[]>(
    props.iterationTimesRef || [...props.persistedState.iterationTimes]
  );

  // Export wrapped state setter for external access. Calls requestRender()
  // after updates to ensure TUI refreshes on all platforms.
  globalSetState = (update) => {
    log("app", "globalSetState called");
    const result = setState(update);
    renderer.requestRender?.();
    return result;
  };
  globalUpdateIterationTimes = (times: number[]) => setIterationTimes(times);
  globalOnSessionCreated = (sessionId: string, sendMessage: (message: string) => Promise<void>) => {
    log("app", "Session created callback received", { 
      sessionId,
      hasSendMessage: !!sendMessage,
      sendMessageType: typeof sendMessage
    });
    setSendMessage(() => sendMessage);
    log("app", "SendMessage function set");
  };
  globalOnSessionEnded = () => {
    log("app", "Session ended");
    setSendMessage(() => null);
  };
  globalOnSessionsList = (sessionsList: Array<{ id: string; created: string }>) => {
    log("app", "Sessions list callback", { count: sessionsList.length });
    setSessions(sessionsList);
  };
  globalOnSwitchSession = (sessionId: string) => {
    log("app", "Switching session", { sessionId });
    (globalThis as any).ralphSwitchSession?.(sessionId);
  };
  
  log("app", "Global state setters initialized");
  
  // Notify parent that state setters are ready
  if (props.onStateSettersReady) {
    const stateSetters: AppStateSetters = {
      setState: globalSetState!,
      updateIterationTimes: globalUpdateIterationTimes!,
      onSessionCreated: globalOnSessionCreated!,
      onSessionEnded: globalOnSessionEnded!,
      onSessionsList: globalOnSessionsList!,
      onSwitchSession: globalOnSwitchSession!,
    };
    log("app", "Calling onStateSettersReady callback");
    props.onStateSettersReady(stateSetters);
  }

  // Track elapsed time from the persisted start time
  const [elapsed, setElapsed] = createSignal(
    Date.now() - props.persistedState.startTime
  );

  // Update elapsed time periodically (5000ms to reduce render frequency)
  // Skip updates when idle or paused to reduce unnecessary re-renders
  const elapsedInterval = setInterval(() => {
    const currentState = state();
    if (!currentState.isIdle && currentState.status !== "paused") {
      setElapsed(Date.now() - props.persistedState.startTime);
    }
  }, 5000);

  onCleanup(() => {
    log("app", "App component cleanup");
    clearInterval(elapsedInterval);
    // Clean up module-level references
    globalSetState = null;
    globalUpdateIterationTimes = null;
    globalOnSessionCreated = null;
    globalOnSessionEnded = null;
    globalOnSessionsList = null;
    globalOnSwitchSession = null;
  });

  log("app", "App component initialization complete, rendering JSX");

  // Calculate ETA based on iteration times and remaining tasks
  const eta = () => {
    const currentState = state();
    const remainingTasks = currentState.totalTasks - currentState.tasksComplete;
    return calculateEta(iterationTimes(), remainingTasks);
  };

  // Pause file path
  const PAUSE_FILE = ".ralph-pause";

  // Toggle pause by creating/deleting .ralph-pause file
  const togglePause = async () => {
    const file = Bun.file(PAUSE_FILE);
    const exists = await file.exists();
    if (exists) {
      // Resume: delete pause file and update status
      await Bun.write(PAUSE_FILE, "");
      const fs = await import("node:fs/promises");
      await fs.unlink(PAUSE_FILE);
      setState((prev) => ({ ...prev, status: "running" }));
    } else {
      // Pause: create pause file and update status
      await Bun.write(PAUSE_FILE, String(process.pid));
      setState((prev) => ({ ...prev, status: "paused" }));
    }
  };

  // Send steering message
  const sendSteeringMessage = async () => {
    const message = commandInput().trim();
    log("app", "sendSteeringMessage called", { 
      message,
      messageLength: message.length,
      isEmpty: !message,
      hasSender: !!sendMessage(),
      currentSender: sendMessage()?.toString()
    });
    
    if (!message) {
      log("app", "Message is empty, closing command mode");
      setCommandMode(false);
      setCommandInput("");
      return;
    }
    
    const sender = sendMessage();
    log("app", "Sender check", { 
      hasSender: !!sender,
      senderType: typeof sender
    });
    
    if (sender) {
      try {
        log("app", "About to call sender function", { message });
        await sender(message);
        log("app", "Sent steering message successfully", { message });
      } catch (e) {
        log("app", "Failed to send steering message", { 
          error: String(e),
          errorType: typeof e,
          stack: e instanceof Error ? e.stack : null
        });
      }
    } else {
      log("app", "No active session to send message");
      console.warn("Ralph: No active session to send steering message");
    }
    
    log("app", "Closing command mode");
    setCommandMode(false);
    setCommandInput("");
  };

  // Track if we've notified about keyboard events working (only notify once)
  let keyboardEventNotified = false;

  // Keyboard handling
  useKeyboard((e: KeyEvent) => {
    log("app", "useKeyboard callback called", { key: e.name, ctrl: e.ctrl, meta: e.meta, raw: e.raw });
    
    // Notify caller that OpenTUI keyboard handling is working
    // This allows the caller to skip setting up a fallback stdin handler
    if (!keyboardEventNotified && props.onKeyboardEvent) {
      keyboardEventNotified = true;
      props.onKeyboardEvent();
    }

    const key = e.name.toLowerCase();
    const keyDisplay = e.raw || key;

    // Debug: log key press for troubleshooting
    log("app", "Key pressed", { 
      name: key, 
      raw: e.raw, 
      ctrl: e.ctrl, 
      meta: e.meta,
      isCommandMode: commandMode()
    });

    // : key: enter command mode for steering messages
    // Check both name and raw sequence for colon character
    const isColon = key === "colon" || e.raw === ":" || (key === "semicolon" && e.shift);
    if (isColon && !e.ctrl && !e.meta) {
      log("app", "Entering command mode via colon key");
      setCommandMode(true);
      setCommandInput(""); // Clear any previous input
      return;
    }

    // s key: switch sessions (cycle through available sessions)
    if (key === "s" && !e.ctrl && !e.meta && !commandMode()) {
      const sessionsList = sessions();
      if (sessionsList.length > 0) {
        const currentIndex = sessionsList.findIndex((s) => s.id === (globalThis as any).ralphCurrentSessionId?.());
        const nextIndex = (currentIndex + 1) % sessionsList.length;
        const nextSession = sessionsList[nextIndex];
        log("app", "Switching session", { currentIndex, nextIndex, nextId: nextSession.id });
        globalOnSwitchSession?.(nextSession.id);
      } else {
        log("app", "No sessions to switch");
      }
      return;
    }

    // t key: toggle tasks panel (only works when NOT in command mode)
    if (key === "t" && !e.ctrl && !e.meta && !commandMode()) {
      log("app", "T key pressed", { currentShowTasks: showTasks(), newShowTasks: !showTasks(), inCommandMode: commandMode() });
      setShowTasks(!showTasks());
      return;
    }

    // ESC key: exit overlays
    if (key === "escape" && !e.ctrl && !e.meta) {
      if (commandMode()) {
        log("app", "Exiting command mode via ESC");
        setCommandMode(false);
        setCommandInput("");
        return;
      }
      if (showTasks()) {
        log("app", "Closing tasks panel via ESC");
        setShowTasks(false);
        return;
      }
    }

    // Handle Enter in command mode
    if (commandMode() && key === "enter" && !e.ctrl && !e.meta) {
      log("app", "Enter pressed in command mode, sending message");
      sendSteeringMessage();
      return;
    }

    // CRITICAL: When in command mode, let ALL other keys pass through to input component
    // Don't process any other keyboard shortcuts when in command mode
    if (commandMode()) {
      log("app", "In command mode, letting input component handle key", { key });
      return; // Allow all other keys to reach the input component
    }

    // s key: switch sessions (cycle through available sessions)
    if (key === "s" && !e.ctrl && !e.meta && !commandMode()) {
      const sessionsList = sessions();
      if (sessionsList.length > 0) {
        const currentIndex = sessionsList.findIndex((s) => s.id === (globalThis as any).ralphCurrentSessionId?.());
        const nextIndex = (currentIndex + 1) % sessionsList.length;
        const nextSession = sessionsList[nextIndex];
        log("app", "Switching session", { currentIndex, nextIndex, nextId: nextSession.id });
        globalOnSwitchSession?.(nextSession.id);
      } else {
        log("app", "No sessions to switch");
      }
      return;
    }

    // t key: toggle tasks panel (only works when NOT in command mode)
    if (key === "t" && !e.ctrl && !e.meta && !commandMode()) {
      log("app", "T key pressed", { currentShowTasks: showTasks(), newShowTasks: !showTasks(), inCommandMode: commandMode() });
      setShowTasks(!showTasks());
      return;
    }

    // Handle Enter in command mode
    if (commandMode() && key === "enter" && !e.ctrl && !e.meta) {
      log("app", "Enter pressed in command mode, sending message");
      sendSteeringMessage();
      return;
    }

    // ESC key: exit overlays
    if (key === "escape" && !e.ctrl && !e.meta) {
      if (commandMode()) {
        log("app", "Exiting command mode via ESC");
        setCommandMode(false);
        setCommandInput("");
        return;
      }
      if (showTasks()) {
        log("app", "Closing tasks panel via ESC");
        setShowTasks(false);
        return;
      }
    }

    // Don't process other keys when in command mode
    // EXCEPT for ESC (handled above) - let input components handle their own events
    if (commandMode()) {
      // Only block ESC (already handled above) and other navigation keys
      // Let input components handle Enter and other input-specific keys
      log("app", "In command mode, allowing input component to handle key", { key });
      // Don't return here - let the input component handle the key
    }

    // Dismiss error overlay on any key press
    if (showError()) {
      log("app", "Dismissing error overlay via key press", { key });
      setShowError(false);
      setErrorMessage(null);
      return;
    }

    // p key: toggle pause
    if (key === "p" && !e.ctrl && !e.meta) {
      togglePause();
      return;
    }

    // q key: quit
    if (key === "q" && !e.ctrl && !e.meta) {
      log("app", "Quit requested via 'q' key");
      renderer.setTerminalTitle("");
      renderer.destroy();
      props.onQuit();
      return;
    }

    // Ctrl+C: quit
    if (key === "c" && e.ctrl) {
      log("app", "Quit requested via Ctrl+C");
      renderer.setTerminalTitle("");
      renderer.destroy();
      props.onQuit();
      return;
    }
  });

  log("app", "useKeyboard registered, about to return JSX");

  return (
    <box
      flexDirection="column"
      width="100%"
      height="100%"
      backgroundColor={colors.bgDark}
    >
      <Header
        status={state().status}
        iteration={state().iteration}
        tasksComplete={state().tasksComplete}
        totalTasks={state().totalTasks}
        eta={eta()}
        tasks={tasks()}
        showTasks={showTasks()}
        onToggleTasks={() => setShowTasks(!showTasks())}
      />
      <Log events={state().events} isIdle={state().isIdle} />
      <Footer
        commits={state().commits}
        elapsed={elapsed()}
        paused={state().status === "paused"}
        linesAdded={state().linesAdded}
        linesRemoved={state().linesRemoved}
        commandMode={commandMode()}
        showTasks={showTasks()}
      />
      <Show when={showError() && errorMessage()}>
        <ErrorOverlay
          error={errorMessage()!}
          onDismiss={() => setShowError(false)}
        />
      </Show>
      <PausedOverlay visible={state().status === "paused"} />
      <Show when={showTasks()}>
        <TasksPanel
          tasks={tasks()}
          onClose={() => setShowTasks(false)}
        />
      </Show>
      <Show when={commandMode()}>
        <box
          position="absolute"
          top={0}
          left={0}
          right={0}
          bottom={0}
          backgroundColor="rgba(0, 0, 0, 0.9)"
          flexDirection="column"
          justifyContent="center"
          alignItems="center"
        >
          <box
            backgroundColor={colors.bgDark}
            borderColor={colors.purple}
            borderStyle="single"
            padding={2}
            paddingLeft={3}
            paddingRight={3}
            flexDirection="column"
            width={70}
            height={10}
          >
            <text style={{ fg: colors.purple }}>
              Send steering message to agent:
            </text>
            <box height={1} />
            <input
              value={commandInput()}
              placeholder="Type message and press Enter"
              onInput={(e: any) => {
                log("app", "Input", { 
                  onInputCalledEvent: e, 
                  value: e.value, 
                  currentInput: commandInput(),
                  target: e.target 
                });
                setCommandInput(e.value);
              }}
              onSubmit={(e: any) => {
                log("app", "Input onSubmit called", { 
                  event: e, 
                  currentInput: commandInput(),
                  target: e.target 
                });
                sendSteeringMessage();
              }}
              focusedBackgroundColor={colors.bgHighlight}
              focusedTextColor={colors.fg}
              cursorColor={colors.cyan}
            />
            <box height={1} />
            <text style={{ fg: colors.fgMuted }}>
              ESC: cancel | Enter: send | Ctrl+C: quit
            </text>
          </box>
        </box>
      </Show>
    </box>
  );
}

export function startApp(props: AppProps & { 
  onStateSettersReady?: (setters: AppStateSetters) => void 
}): StartAppResult {
  try {
    log("app", "startApp() called");
    
    let resolveExitPromise: (() => void) | null = null;

    const exitPromise = new Promise<void>((resolve) => {
      resolveExitPromise = resolve;
    });

    log("app", "About to render App component");
    render(
      () => <App
        options={props.options}
        persistedState={props.persistedState}
        onQuit={() => {
          log("app", "onQuit() callback triggered");
          props.onQuit();
          if (resolveExitPromise) {
            resolveExitPromise();
          }
        }}
        iterationTimesRef={props.iterationTimesRef}
        onKeyboardEvent={props.onKeyboardEvent}
        onSessionCreated={props.onSessionCreated}
        onSessionEnded={props.onSessionEnded}
        onSessionsList={props.onSessionsList}
        onSwitchSession={props.onSwitchSession}
        setSendMessageRef={props.setSendMessageRef}
        onStateSettersReady={props.onStateSettersReady}
      />,
      {
        targetFps: 30,
        gatherStats: false,
        exitOnCtrlC: false,
        useKittyKeyboard: {},
      }
    );
    log("app", "render() called successfully");

    log("app", "startApp() returning result (stateSetters will be provided via callback)");
    return {
      exitPromise,
      // Return a placeholder that will be filled in by the callback
      // @ts-ignore - temporarily bypassing TypeScript
      stateSetters: undefined,
    };
  } catch (error) {
    log("app", "ERROR in startApp", { error: String(error), stack: error instanceof Error ? error.stack : null });
    throw error;
  }
}
