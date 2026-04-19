import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountChatbotDrawer } from "../../../src/chatbot/chatbot-drawer";
import type { ChatRequest } from "../../../src/chatbot/chat-client";

function baseRequest(): ChatRequest {
  return {
    mode: "build",
    hintLevel: "coach",
    wave: {
      id: "w1",
      title: "Launch",
      intensity: 10,
      composition: {
        writeRatio: 0,
        authRatio: 0,
        streamRatio: 0,
        largeRatio: 0,
        asyncRatio: 0,
      },
      duration: 60,
      sla: { availability: 0.99, maxAvgLatencySeconds: 2, maxDropRate: 0.01 },
    },
    topology: { components: [], connections: [] },
    liveMetrics: {
      availability: 1,
      avgLatencySeconds: 0,
      dropRate: 0,
      currentTickSeconds: 0,
    },
    recentEvents: [],
    conversationHistory: [],
    userMessage: "",
  };
}

function resetDom(): void {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("mountChatbotDrawer", () => {
  beforeEach(() => {
    resetDom();
  });

  it("renders the collapsed tab by default and expands on click", () => {
    const handle = mountChatbotDrawer({
      host: document.body,
      getContext: () => baseRequest(),
      skipAuth: true,
    });

    const root = document.querySelector(".cp-chatbot")!;
    expect(root.classList.contains("cp-chatbot--closed")).toBe(true);
    expect(handle.isOpen()).toBe(false);

    const tab = document.querySelector<HTMLButtonElement>(
      '[data-testid="cp-chatbot-tab"]',
    )!;
    tab.click();

    expect(handle.isOpen()).toBe(true);
    expect(root.classList.contains("cp-chatbot--open")).toBe(true);
  });

  it("sends user message, appends both user + assistant bubbles, tracks history", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        mockJsonResponse({ reply: "Your **server** is saturated." }),
      );

    const handle = mountChatbotDrawer({
      host: document.body,
      getContext: () => baseRequest(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endpoint: "https://example.test/fn",
      skipAuth: true,
    });
    handle.open();

    await handle.send("why are drops spiking?");

    const userBubbles = document.querySelectorAll('[data-role="user"]');
    const assistantBubbles = document.querySelectorAll(
      '[data-role="assistant"]',
    );
    // Welcome bubble + the new assistant reply = 2 assistant bubbles.
    expect(userBubbles.length).toBe(1);
    expect(assistantBubbles.length).toBe(2);
    expect(userBubbles[0]!.textContent).toContain("drops spiking");
    // Markdown bold rendered as <strong>.
    expect(assistantBubbles[1]!.innerHTML).toContain("<strong>server</strong>");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as ChatRequest;
    expect(body.userMessage).toBe("why are drops spiking?");
    expect(body.hintLevel).toBe("coach");
    // First call — history is empty when this request was sent.
    expect(body.conversationHistory).toEqual([]);

    // A follow-up call should include the prior exchange in history.
    fetchImpl.mockResolvedValueOnce(mockJsonResponse({ reply: "More detail." }));
    await handle.send("tell me more");
    const [, init2] = fetchImpl.mock.calls[1] as [string, RequestInit];
    const body2 = JSON.parse(init2.body as string) as ChatRequest;
    expect(body2.conversationHistory.length).toBe(2);
    expect(body2.conversationHistory[0]).toEqual({
      role: "user",
      content: "why are drops spiking?",
    });
    expect(body2.conversationHistory[1]!.role).toBe("assistant");
  });

  it("clears the conversation on CLEAR click", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ reply: "OK." }));

    const handle = mountChatbotDrawer({
      host: document.body,
      getContext: () => baseRequest(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endpoint: "https://example.test/fn",
      skipAuth: true,
    });
    handle.open();
    await handle.send("first");

    expect(document.querySelectorAll('[data-role="user"]').length).toBe(1);

    const clearBtn = document.querySelector<HTMLButtonElement>(
      '[data-testid="cp-chatbot-clear"]',
    )!;
    clearBtn.click();

    expect(document.querySelectorAll(".cp-chatbot-msg").length).toBe(0);
  });

  it("updates hintLevel on dropdown change and uses it in subsequent requests", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ reply: "Hi." }));

    const handle = mountChatbotDrawer({
      host: document.body,
      getContext: () => baseRequest(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endpoint: "https://example.test/fn",
      skipAuth: true,
    });
    handle.open();

    const select = document.querySelector<HTMLSelectElement>(
      '[data-testid="cp-chatbot-hint"]',
    )!;
    select.value = "mentor";
    select.dispatchEvent(new Event("change"));

    expect(handle.getHintLevel()).toBe("mentor");

    await handle.send("q");
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as ChatRequest;
    expect(body.hintLevel).toBe("mentor");
  });

  it("shows an error bubble when the request fails", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("DNS fail"));

    const handle = mountChatbotDrawer({
      host: document.body,
      getContext: () => baseRequest(),
      fetchImpl: fetchImpl as unknown as typeof fetch,
      endpoint: "https://example.test/fn",
      skipAuth: true,
    });
    handle.open();
    await handle.send("q");

    const err = document.querySelector('[data-role="error"]');
    expect(err).not.toBeNull();
    expect(err!.textContent).toContain("Tutor offline");
  });
});
