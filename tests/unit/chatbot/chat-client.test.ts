import { describe, expect, it, vi } from "vitest";
import {
  ChatClientError,
  sendChatMessage,
  type ChatRequest,
} from "../../../src/chatbot/chat-client";

function makeRequest(overrides: Partial<ChatRequest> = {}): ChatRequest {
  return {
    mode: "diagnose",
    hintLevel: "coach",
    levelId: "level-1",
    wave: {
      id: "w1",
      title: "Launch",
      intensity: 12,
      composition: {
        writeRatio: 0.3,
        authRatio: 0.2,
        streamRatio: 0.1,
        largeRatio: 0.05,
        asyncRatio: 0.05,
      },
      duration: 60,
      sla: { availability: 0.99, maxAvgLatencySeconds: 2, maxDropRate: 0.01 },
    },
    topology: {
      components: [{ id: "s1", type: "Server", utilization: 0.8 }],
      connections: [{ from: "lb", to: "s1" }],
    },
    liveMetrics: {
      availability: 0.97,
      avgLatencySeconds: 1.8,
      dropRate: 0.03,
      currentTickSeconds: 22,
    },
    recentEvents: [{ t: 20, type: "saturation", detail: "s1 queue full" }],
    conversationHistory: [],
    userMessage: "Why am I dropping traffic?",
    ...overrides,
  };
}

function mockJsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("sendChatMessage", () => {
  it("POSTs the request body as JSON to the endpoint", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ reply: "Look at s1." }));

    const req = makeRequest();
    const res = await sendChatMessage(req, {
      endpoint: "https://example.test/functions/v1/stack-attack-chat",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      skipAuth: true,
    });

    expect(res).toEqual({ reply: "Look at s1." });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.test/functions/v1/stack-attack-chat");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["content-type"]).toBe("application/json");
    expect(headers["authorization"]).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual(req);
  });

  it("passes through highlights and suggestedAction from the server", async () => {
    const payload = {
      reply: "Your write path is saturated.",
      highlights: ["s1", "db1"],
      suggestedAction: { action: "add", target: "DataCache" },
    };
    const fetchImpl = vi.fn().mockResolvedValue(mockJsonResponse(payload));

    const res = await sendChatMessage(makeRequest(), {
      endpoint: "https://example.test/fn",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      skipAuth: true,
    });

    expect(res).toEqual(payload);
  });

  it("returns the server's reply field even on non-2xx rate-limit responses", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      mockJsonResponse(
        { error: "rate_limited", reply: "Slow down, coach." },
        429,
      ),
    );

    const res = await sendChatMessage(makeRequest(), {
      endpoint: "https://example.test/fn",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      skipAuth: true,
    });

    expect(res.reply).toBe("Slow down, coach.");
  });

  it("throws ChatClientError on non-2xx responses without a reply", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ error: "boom" }, 500));

    await expect(
      sendChatMessage(makeRequest(), {
        endpoint: "https://example.test/fn",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        skipAuth: true,
      }),
    ).rejects.toBeInstanceOf(ChatClientError);
  });

  it("throws ChatClientError when fetch itself rejects (network error)", async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error("DNS fail"));

    await expect(
      sendChatMessage(makeRequest(), {
        endpoint: "https://example.test/fn",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        skipAuth: true,
      }),
    ).rejects.toThrow(/Network error/);
  });

  it("throws ChatClientError on malformed JSON success responses", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(mockJsonResponse({ nope: true }));

    await expect(
      sendChatMessage(makeRequest(), {
        endpoint: "https://example.test/fn",
        fetchImpl: fetchImpl as unknown as typeof fetch,
        skipAuth: true,
      }),
    ).rejects.toThrow(/malformed/);
  });
});
