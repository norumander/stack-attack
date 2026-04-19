/**
 * Stack Attack Tutor — collapsible right-edge chat drawer.
 *
 * Vanilla DOM; no framework. Styles live in `chatbot-drawer.css`.
 *
 * The drawer owns its own conversation state (session-scoped — cleared on
 * page reload). The host wires `getContext()` to produce a ChatRequest from
 * the live sim / wave / metrics; the drawer fills in `userMessage` and
 * `conversationHistory` at send time.
 */
import type { ComponentId } from "@core/types/ids";
import {
  sendChatMessage,
  type ChatHistoryMessage,
  type ChatRequest,
  type ChatResponse,
  type HintLevel,
} from "./chat-client";
import { renderMarkdown } from "./markdown-mini";

export interface ChatbotDrawerOptions {
  host: HTMLElement;
  /** Returns a ChatRequest pre-filled except for userMessage/history/hintLevel.
   *  Null means context is unavailable (e.g., pre-wave) — drawer falls back to
   *  a minimal placeholder request so the user still gets a response. */
  getContext: () => ChatRequest | null;
  onHighlight?: (ids: ComponentId[]) => void;
  /** Override fetch impl (tests). */
  fetchImpl?: typeof fetch;
  /** Override endpoint (tests). */
  endpoint?: string;
  /** Skip Supabase auth lookup (tests / anon mode). */
  skipAuth?: boolean;
}

export interface ChatbotDrawerHandle {
  open: () => void;
  close: () => void;
  isOpen: () => boolean;
  /** Send a message programmatically (used by quick-chips + tests). */
  send: (text: string) => Promise<void>;
  /** Clear conversation history. */
  clear: () => void;
  /** Set hint level programmatically. */
  setHintLevel: (level: HintLevel) => void;
  getHintLevel: () => HintLevel;
  destroy: () => void;
}

const QUICK_CHIPS: ReadonlyArray<string> = [
  "What's the bottleneck?",
  "Why are drops spiking?",
  "Should I add a cache?",
];

export function mountChatbotDrawer(
  opts: ChatbotDrawerOptions,
): ChatbotDrawerHandle {
  const state = {
    open: false,
    hintLevel: "coach" as HintLevel,
    history: [] as ChatHistoryMessage[],
    sending: false,
  };

  // ── root ──
  const root = document.createElement("div");
  root.className = "cp-chatbot cp-chatbot--closed";
  root.setAttribute("data-testid", "cp-chatbot");

  // ── collapsed tab ──
  const tab = document.createElement("button");
  tab.type = "button";
  tab.className = "cp-chatbot-tab";
  tab.setAttribute("aria-label", "Open Stack Attack tutor");
  tab.setAttribute("data-testid", "cp-chatbot-tab");
  tab.innerHTML =
    '<span class="cp-chatbot-tab-icon" aria-hidden="true">&#x25B8;</span>' +
    '<span class="cp-chatbot-tab-label">TUTOR</span>';
  tab.addEventListener("click", () => setOpen(true));

  // ── panel ──
  const panel = document.createElement("div");
  panel.className = "cp-chatbot-panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Stack Attack tutor");

  // Header
  const header = document.createElement("div");
  header.className = "cp-chatbot-header";
  const title = document.createElement("div");
  title.className = "cp-chatbot-title";
  title.textContent = "STACK ATTACK TUTOR";
  header.appendChild(title);

  const hintSelect = document.createElement("select");
  hintSelect.className = "cp-chatbot-hint";
  hintSelect.setAttribute("data-testid", "cp-chatbot-hint");
  hintSelect.setAttribute("aria-label", "Hint level");
  for (const [value, label] of [
    ["explorer", "Explorer"],
    ["coach", "Coach"],
    ["mentor", "Mentor"],
  ] as const) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (value === state.hintLevel) opt.selected = true;
    hintSelect.appendChild(opt);
  }
  hintSelect.addEventListener("change", () => {
    state.hintLevel = hintSelect.value as HintLevel;
  });
  header.appendChild(hintSelect);

  const clearBtn = document.createElement("button");
  clearBtn.type = "button";
  clearBtn.className = "cp-chatbot-clear";
  clearBtn.setAttribute("data-testid", "cp-chatbot-clear");
  clearBtn.title = "Clear conversation";
  clearBtn.textContent = "CLEAR";
  clearBtn.addEventListener("click", () => clearConversation());
  header.appendChild(clearBtn);

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "cp-chatbot-close";
  closeBtn.setAttribute("aria-label", "Close tutor");
  closeBtn.textContent = "\u00D7"; // ×
  closeBtn.addEventListener("click", () => setOpen(false));
  header.appendChild(closeBtn);

  panel.appendChild(header);

  // Message list
  const messages = document.createElement("div");
  messages.className = "cp-chatbot-messages";
  messages.setAttribute("data-testid", "cp-chatbot-messages");
  panel.appendChild(messages);

  // Quick-send chips
  const chipsRow = document.createElement("div");
  chipsRow.className = "cp-chatbot-chips";
  for (const chip of QUICK_CHIPS) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "cp-chatbot-chip";
    b.textContent = chip;
    b.addEventListener("click", () => {
      if (state.sending) return;
      void send(chip);
    });
    chipsRow.appendChild(b);
  }
  panel.appendChild(chipsRow);

  // Input
  const inputRow = document.createElement("form");
  inputRow.className = "cp-chatbot-input-row";
  inputRow.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = textarea.value.trim();
    if (!text) return;
    textarea.value = "";
    void send(text);
  });

  const textarea = document.createElement("textarea");
  textarea.className = "cp-chatbot-input";
  textarea.setAttribute("data-testid", "cp-chatbot-input");
  textarea.placeholder = "Ask the tutor… (Enter to send, Shift+Enter newline)";
  textarea.rows = 2;
  textarea.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      inputRow.dispatchEvent(new Event("submit", { cancelable: true }));
    }
  });
  inputRow.appendChild(textarea);

  const sendBtn = document.createElement("button");
  sendBtn.type = "submit";
  sendBtn.className = "cp-chatbot-send";
  sendBtn.setAttribute("data-testid", "cp-chatbot-send");
  sendBtn.textContent = "SEND";
  inputRow.appendChild(sendBtn);

  panel.appendChild(inputRow);

  root.appendChild(tab);
  root.appendChild(panel);
  opts.host.appendChild(root);

  // ── helpers ──
  function setOpen(next: boolean): void {
    state.open = next;
    root.classList.toggle("cp-chatbot--open", next);
    root.classList.toggle("cp-chatbot--closed", !next);
    if (next) {
      // Focus input on open.
      setTimeout(() => textarea.focus(), 0);
      if (messages.childElementCount === 0) {
        appendAssistantBubble(
          "Welcome. I can explain what your topology is doing and suggest fixes. Ask me what's going wrong, or tap a chip below.",
        );
      }
    }
  }

  function scrollToBottom(): void {
    messages.scrollTop = messages.scrollHeight;
  }

  function appendUserBubble(text: string): void {
    const row = document.createElement("div");
    row.className = "cp-chatbot-msg cp-chatbot-msg--user";
    row.setAttribute("data-role", "user");
    row.textContent = text;
    messages.appendChild(row);
    scrollToBottom();
  }

  function appendAssistantBubble(markdown: string): HTMLElement {
    const row = document.createElement("div");
    row.className = "cp-chatbot-msg cp-chatbot-msg--assistant";
    row.setAttribute("data-role", "assistant");
    row.innerHTML = renderMarkdown(markdown);
    messages.appendChild(row);
    scrollToBottom();
    return row;
  }

  function appendError(text: string): void {
    const row = document.createElement("div");
    row.className = "cp-chatbot-msg cp-chatbot-msg--error";
    row.setAttribute("data-role", "error");
    row.textContent = text;
    messages.appendChild(row);
    scrollToBottom();
  }

  function setSending(next: boolean): void {
    state.sending = next;
    sendBtn.disabled = next;
    textarea.disabled = next;
    root.classList.toggle("cp-chatbot--sending", next);
  }

  function clearConversation(): void {
    state.history = [];
    while (messages.firstChild) messages.removeChild(messages.firstChild);
  }

  async function send(text: string): Promise<void> {
    if (state.sending) return;
    const trimmed = text.trim();
    if (!trimmed) return;

    appendUserBubble(trimmed);
    setSending(true);

    // Loading indicator bubble
    const loading = document.createElement("div");
    loading.className = "cp-chatbot-msg cp-chatbot-msg--assistant cp-chatbot-msg--loading";
    loading.textContent = "…";
    messages.appendChild(loading);
    scrollToBottom();

    let ctx: ChatRequest | null = null;
    try {
      ctx = opts.getContext();
    } catch {
      ctx = null;
    }

    const req = buildRequest(ctx, trimmed);
    let res: ChatResponse | null = null;
    try {
      const sendOpts: {
        fetchImpl?: typeof fetch;
        endpoint?: string;
        skipAuth?: boolean;
      } = {};
      if (opts.fetchImpl) sendOpts.fetchImpl = opts.fetchImpl;
      if (opts.endpoint) sendOpts.endpoint = opts.endpoint;
      if (opts.skipAuth !== undefined) sendOpts.skipAuth = opts.skipAuth;
      res = await sendChatMessage(req, sendOpts);
    } catch (err) {
      loading.remove();
      appendError(`Tutor offline: ${(err as Error).message}`);
      setSending(false);
      return;
    }

    loading.remove();
    appendAssistantBubble(res.reply);

    // Update history AFTER the exchange succeeds.
    state.history.push({ role: "user", content: trimmed });
    state.history.push({ role: "assistant", content: res.reply });

    if (res.highlights && res.highlights.length > 0 && opts.onHighlight) {
      opts.onHighlight(res.highlights as ComponentId[]);
    }

    setSending(false);
  }

  function buildRequest(
    ctx: ChatRequest | null,
    userMessage: string,
  ): ChatRequest {
    if (ctx) {
      return {
        ...ctx,
        hintLevel: state.hintLevel,
        userMessage,
        conversationHistory: state.history.slice(),
      };
    }
    // Minimal fallback so the UI is usable pre-wave (the edge function's stub
    // mode also handles this gracefully).
    return {
      mode: "build",
      hintLevel: state.hintLevel,
      wave: {
        id: "pre-wave",
        title: "Pre-wave",
        intensity: 0,
        composition: {
          writeRatio: 0,
          authRatio: 0,
          streamRatio: 0,
          largeRatio: 0,
          asyncRatio: 0,
        },
        duration: 0,
        sla: { availability: 1, maxAvgLatencySeconds: 1, maxDropRate: 0 },
      },
      topology: { components: [], connections: [] },
      liveMetrics: {
        availability: 1,
        avgLatencySeconds: 0,
        dropRate: 0,
        currentTickSeconds: 0,
      },
      recentEvents: [],
      conversationHistory: state.history.slice(),
      userMessage,
    };
  }

  return {
    open: () => setOpen(true),
    close: () => setOpen(false),
    isOpen: () => state.open,
    send,
    clear: clearConversation,
    setHintLevel: (level: HintLevel) => {
      state.hintLevel = level;
      hintSelect.value = level;
    },
    getHintLevel: () => state.hintLevel,
    destroy: () => {
      root.remove();
    },
  };
}
