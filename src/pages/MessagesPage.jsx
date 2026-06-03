import { useState, useEffect, useRef, useCallback } from "react";
import { api, WS_BASE } from "../api";
import { useAuth } from "../AuthContext";
import { useToast } from "../ToastContext";
import { AvatarImg } from "../components/AvatarImg";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";

function timeAgo(date) {
  try {
    // Accept Date, timestamp (number), or ISO string
    const d = typeof date === "number" ? new Date(date) : new Date(date);
    return formatDistanceToNow(d, { addSuffix: true, locale: vi });
  } catch {
    return "";
  }
}

function normalizeMessage(msg) {
  // Ensure created_at is an ISO string parsable by Date on client
  const out = { ...msg };
  try {
    if (typeof out.content === "string") {
      out.content = out.content.normalize("NFC");
    }

    const parseUtcIfNaive = (value) => {
      if (typeof value !== "string") return value;
      const hasTimezone = /([zZ]|[+-]\d\d:?\d\d)$/.test(value);
      return hasTimezone ? value : `${value}Z`;
    };

    if (!out.created_at) {
      out.created_at = new Date().toISOString();
    } else if (typeof out.created_at === "number") {
      out.created_at = new Date(out.created_at).toISOString();
    } else if (typeof out.created_at === "object" && out.created_at !== null) {
      // Handle Mongo-style $date or other nested shapes
      const maybe =
        out.created_at.$date || out.created_at["$date"] || out.created_at;
      out.created_at = new Date(maybe).toISOString();
    } else {
      // string or other
      const parsed = Date.parse(parseUtcIfNaive(out.created_at));
      if (!isNaN(parsed)) out.created_at = new Date(parsed).toISOString();
      else out.created_at = new Date().toISOString();
    }
  } catch (e) {
    out.created_at = new Date().toISOString();
  }
  return out;
}

function ChatWindow({ match, onBack }) {
  const { user } = useAuth();
  const toast = useToast();
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState("");
  const [partnerOnline, setPartnerOnline] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [wsReady, setWsReady] = useState(false);
  const [statusMessage, setStatusMessage] = useState("Đang kết nối...");
  const [retrying, setRetrying] = useState(false);
  const wsRef = useRef(null);
  const reconnectRef = useRef(null);
  const pendingRef = useRef([]);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);
  const scrolledToBottom = useRef(false);

  const scrollToBottom = (smooth = true) => {
    bottomRef.current?.scrollIntoView({ behavior: smooth ? "smooth" : "auto" });
  };

  useEffect(() => {
    scrolledToBottom.current = false;
    setWsReady(false);
    setStatusMessage("Đang kết nối...");
    setRetrying(false);

    const ws = new WebSocket(`${WS_BASE}/chat/ws/${match.id}`);
    wsRef.current = ws;
    let historyTimeout = null;
    let historyReceived = false;
    ws.onopen = () => {
      setWsReady(true);
      setStatusMessage("Đã kết nối");
      // flush pending messages queued while offline
      try {
        if (pendingRef.current && pendingRef.current.length) {
          pendingRef.current.forEach((p) => ws.send(JSON.stringify(p)));
          pendingRef.current = [];
        }
      } catch (e) {
        console.warn("Failed to flush pending messages", e);
      }
    };

    ws.onmessage = (e) => {
      let data;
      try {
        data = JSON.parse(e.data);
      } catch {
        return;
      }

      // DEBUG: log incoming socket messages for diagnosis
      try {
        // Use console.debug so user can enable verbose logs in browser
        console.debug("WS:onmessage ->", data);
      } catch (e) {}

      if (data.type === "history") {
        setMessages((data.messages || []).map(normalizeMessage));
        historyReceived = true;
        setHasMore(data.has_more || false);
        setNextCursor(data.next_cursor || null);
        // scroll xuống sau khi render
        setTimeout(() => {
          scrollToBottom(false);
          scrolledToBottom.current = true;
        }, 80);
      } else if (data.type === "message") {
        setMessages((m) => {
          try {
            console.debug("Appending message:", data.message);
          } catch (e) {}
          return [...m, normalizeMessage(data.message)];
        });
        setTimeout(() => scrollToBottom(true), 50);
      } else if (data.type === "system") {
        setPartnerOnline(!!data.user_online);
      } else if (data.type === "error") {
        toast(data.content, "error");
      }
    };

    ws.onclose = (e) => {
      setWsReady(false);
      setRetrying(true);
      setStatusMessage("Kết nối thất bại, đang thử lại...");
      const msgs = {
        4001: "Chưa đăng nhập",
        4003: "Không có quyền vào phòng",
        4004: "Phòng đã đủ 2 người",
      };
      if (msgs[e.code]) toast(msgs[e.code], "error");
      reconnectRef.current = window.setTimeout(() => {
        setRetrying(false);
        setStatusMessage("Đang kết nối lại...");
      }, 1500);
    };

    ws.onerror = () => {
      setWsReady(false);
      setStatusMessage("Lỗi kết nối chat");
      ws.close();
    };

    inputRef.current?.focus();
    // If server doesn't send 'history' (e.g., transient WS issue), fetch via REST as fallback
    historyTimeout = setTimeout(async () => {
      if (!historyReceived) {
        try {
          const data = await api.get(`/chat/${match.id}/history?limit=50`);
          if (data && Array.isArray(data.messages)) {
            setMessages((data.messages || []).map(normalizeMessage));
            setHasMore(data.has_more || false);
            setNextCursor(data.next_cursor || null);
            setTimeout(() => {
              scrollToBottom(false);
              scrolledToBottom.current = true;
            }, 80);
          }
        } catch (err) {
          // ignore
        }
      }
    }, 700);

    return () => {
      clearTimeout(historyTimeout);
      ws.close();
    };
  }, [match.id]);

  // Load thêm tin nhắn cũ hơn qua REST (cursor-based)
  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      // GET /chat/:match_id/history?limit=50&before_id=CURSOR
      const data = await api.get(
        `/chat/${match.id}/history?limit=50&before_id=${nextCursor}`,
      );
      setMessages((m) => [
        ...(data.messages || []).map(normalizeMessage),
        ...m,
      ]);
      setHasMore(data.has_more || false);
      setNextCursor(data.next_cursor || null);
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setLoadingMore(false);
    }
  };

  const sendMsg = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (text.length > 500) {
      toast("Tin nhắn quá dài (tối đa 500 ký tự)", "error");
      return;
    }
    const payload = { content: text.trim().normalize("NFC") };
    try {
      console.debug("WS:send ->", payload);
    } catch (e) {}

    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    } else {
      // Queue the message and notify user; will be flushed when WS reopens
      pendingRef.current = pendingRef.current || [];
      pendingRef.current.push(payload);
      toast("Tin nhắn đã lưu, sẽ gửi khi kết nối được thiết lập", "info");
    }

    setText("");
  };

  // Nhóm tin nhắn liên tiếp cùng sender
  const grouped = messages.reduce((acc, msg) => {
    if (!acc.length || acc[acc.length - 1].senderId !== msg.sender_id) {
      acc.push({
        senderId: msg.sender_id,
        username: msg.sender_username,
        msgs: [msg],
      });
    } else {
      acc[acc.length - 1].msgs.push(msg);
    }
    return acc;
  }, []);

  const isMe = (id) => id === user?.id;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Header */}
      <div
        style={{
          padding: "12px 20px",
          background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          className="btn btn-ghost btn-sm"
          style={{ padding: "6px 10px" }}
        >
          ← Quay lại
        </button>
        <div style={{ position: "relative" }}>
          <AvatarImg
            src={match.avatar_url || null}
            name={match.name}
            size={38}
          />
          {partnerOnline && (
            <div
              className="online-dot"
              style={{ position: "absolute", bottom: 0, right: 0 }}
            />
          )}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: 15 }}>{match.name}</div>
          <div
            style={{
              fontSize: 12,
              color: partnerOnline ? "#22c55e" : "var(--ink-ghost)",
            }}
          >
            {wsReady
              ? partnerOnline
                ? "● Đang online"
                : "○ Offline"
              : "Đang kết nối..."}
          </div>
        </div>
      </div>

      {/* Messages area */}
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 20px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {hasMore && (
          <div style={{ textAlign: "center", paddingBottom: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              onClick={loadMore}
              disabled={loadingMore}
            >
              {loadingMore ? (
                <span className="spinner" style={{ width: 14, height: 14 }} />
              ) : (
                "↑ Tải tin nhắn cũ hơn"
              )}
            </button>
          </div>
        )}

        {messages.length === 0 && (
          <div className="empty-state" style={{ marginTop: 40 }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>💌</div>
            <p>Hãy gửi lời chào đầu tiên!</p>
          </div>
        )}

        {grouped.map((group, gi) => {
          const me = isMe(group.senderId);
          return (
            <div
              key={gi}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: me ? "flex-end" : "flex-start",
                gap: 3,
              }}
            >
              {!me && (
                <span
                  style={{
                    fontSize: 11,
                    color: "var(--ink-ghost)",
                    marginLeft: 8,
                  }}
                >
                  {group.username}
                </span>
              )}
              {group.msgs.map((msg, i) => (
                <div
                  key={msg.id}
                  title={timeAgo(msg.created_at)}
                  style={{
                    maxWidth: "68%",
                    background: me
                      ? "linear-gradient(135deg, var(--rose), var(--rose-light))"
                      : "var(--surface)",
                    color: me ? "white" : "var(--ink)",
                    padding: "9px 14px",
                    borderRadius: me
                      ? `16px 16px ${i === group.msgs.length - 1 ? "4px" : "16px"} 16px`
                      : `16px 16px 16px ${i === group.msgs.length - 1 ? "4px" : "16px"}`,
                    fontSize: 14,
                    lineHeight: 1.5,
                    boxShadow: me
                      ? "0 3px 10px rgba(232,54,74,0.2)"
                      : "var(--shadow-sm)",
                    border: me ? "none" : "1px solid var(--border)",
                    animation: "fadeUp 0.15s ease",
                    wordBreak: "break-word",
                    whiteSpace: "pre-wrap",
                    overflowWrap: "anywhere",
                    unicodeBidi: "plaintext",
                    direction: "ltr",
                  }}
                >
                  {typeof msg.content === "string" ? msg.content : ""}
                  {i === group.msgs.length - 1 && (
                    <div
                      style={{
                        fontSize: 10,
                        opacity: 0.65,
                        marginTop: 3,
                        textAlign: me ? "right" : "left",
                      }}
                    >
                      {timeAgo(msg.created_at)}
                    </div>
                  )}
                </div>
              ))}
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <form
        onSubmit={sendMsg}
        style={{
          padding: "12px 16px",
          background: "var(--surface)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexShrink: 0,
        }}
      >
        <input
          ref={inputRef}
          className="input-field"
          placeholder="Nhắn tin... (tối đa 500 ký tự)"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={500}
          style={{ flex: 1 }}
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!text.trim()}
          style={{
            width: 44,
            height: 44,
            padding: 0,
            borderRadius: "50%",
            fontSize: 18,
          }}
        >
          ↑
        </button>
      </form>
    </div>
  );
}

export function MessagesPage({ chatMatch, setChatMatch }) {
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // GET /api/match/me → danh sách matches đã accept
    api
      .get("/api/match/me")
      .then((d) => setMatches(Array.isArray(d) ? d : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (chatMatch) {
    return <ChatWindow match={chatMatch} onBack={() => setChatMatch(null)} />;
  }

  return (
    <div style={{ maxWidth: 600, margin: "0 auto", padding: "24px 20px" }}>
      <div style={{ marginBottom: 28 }}>
        <h1 style={{ fontSize: 28, color: "var(--rose)", marginBottom: 4 }}>
          Tin nhắn
        </h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>
          Chat với những người đã kết đôi
        </p>
      </div>

      {loading ? (
        <div className="page-loader">
          <span className="spinner" />
        </div>
      ) : matches.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 64, marginBottom: 16 }}>💬</div>
          <h3>Chưa có cuộc trò chuyện nào</h3>
          <p>Kết đôi với ai đó để bắt đầu chat!</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {matches.map((m) => (
            <button
              key={m.id}
              onClick={() =>
                setChatMatch({
                  id: m.id,
                  name: m.user2_username,
                  avatar_url: m.user2_avatar_url,
                })
              }
              style={{
                display: "flex",
                alignItems: "center",
                gap: 14,
                padding: "14px 16px",
                borderRadius: "var(--radius)",
                background: "var(--surface)",
                border: "1px solid var(--border)",
                cursor: "pointer",
                transition: "all 0.2s",
                textAlign: "left",
                width: "100%",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = "var(--rose)";
                e.currentTarget.style.background = "var(--rose-pale)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
                e.currentTarget.style.background = "var(--surface)";
              }}
            >
              <div style={{ position: "relative" }}>
                <AvatarImg
                  src={m.user2_avatar_url}
                  name={m.user2_username}
                  size={50}
                />
                {m.partner_is_online && (
                  <div
                    className="online-dot"
                    style={{ position: "absolute", bottom: 1, right: 1 }}
                  />
                )}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>
                  {m.user2_username}
                </div>
                <div
                  style={{
                    fontSize: 13,
                    color: "var(--ink-soft)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {m.user2_bio || "Nhấn để bắt đầu chat..."}
                </div>
              </div>
              <div
                style={{
                  flexShrink: 0,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                }}
              >
                {m.partner_is_online ? (
                  <span
                    style={{ fontSize: 11, color: "#22c55e", fontWeight: 600 }}
                  >
                    ● Online
                  </span>
                ) : (
                  <span style={{ fontSize: 18 }}>💬</span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
