import { useState, useEffect, useRef, useCallback } from "react";
import { api, BASE_URL } from "../api";
import { useAuth } from "../AuthContext";
import { useToast } from "../ToastContext";
import { AvatarImg } from "../components/AvatarImg";
import { ReportModal } from "../components/ReportModal";
import { formatDistanceToNow } from "date-fns";
import { vi } from "date-fns/locale";

const REACTIONS = [
  { key: "heart", emoji: "❤️" },
  { key: "haha", emoji: "😂" },
  { key: "wow", emoji: "😮" },
  { key: "sad", emoji: "😢" },
  { key: "fire", emoji: "🔥" },
];

const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE_BYTES = 50 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
];
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const ALLOWED_UPLOAD_TYPES = [...ALLOWED_IMAGE_TYPES, ...ALLOWED_VIDEO_TYPES];

const resolveMediaUrl = (url) => {
  if (!url) return url;
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `${BASE_URL}${url}`;
};

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function timeAgo(date) {
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true, locale: vi });
  } catch {
    return "";
  }
}

function SentimentBadge({ score }) {
  if (!score) return null;
  const map = {
    positive: ["sentiment-positive", "✨ Tích cực"],
    negative: ["sentiment-negative", "💔 Tiêu cực"],
    neutral: ["sentiment-neutral", "😐 Trung lập"],
  };
  const [cls, label] = map[score] || map.neutral;
  return <span className={`sentiment-badge ${cls}`}>{label}</span>;
}

function ReactionBar({ reactions, postId, onUpdate }) {
  const toast = useToast();
  const [show, setShow] = useState(false);
  const ref = useRef();

  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setShow(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const total = REACTIONS.reduce(
    (s, r) => s + Number(reactions?.[r.key] || 0),
    0,
  );
  const myReaction = REACTIONS.find((r) => r.key === reactions?.my_reaction);

  const react = async (type) => {
    setShow(false);
    try {
      // POST /api/posts/:id/react  → toggle logic
      const data = await api.post(`/api/posts/${postId}/react`, {
        reaction_type: type,
      });
      onUpdate(data);
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => setShow((s) => !s)}
        style={{
          color: myReaction ? "var(--rose)" : "var(--ink-soft)",
          fontWeight: myReaction ? 700 : 500,
        }}
      >
        {myReaction ? myReaction.emoji : "🤍"} {total > 0 ? total : ""} React
      </button>
      {show && (
        <div
          style={{
            position: "absolute",
            bottom: "110%",
            left: 0,
            zIndex: 20,
            background: "white",
            borderRadius: 100,
            padding: "6px 12px",
            display: "flex",
            gap: 4,
            boxShadow: "var(--shadow-md)",
            border: "1px solid var(--border)",
            animation: "slideDown 0.15s ease",
          }}
        >
          {REACTIONS.map((r) => (
            <button
              key={r.key}
              onClick={() => react(r.key)}
              title={r.key}
              style={{
                fontSize: 22,
                padding: "4px 6px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                background:
                  reactions?.my_reaction === r.key
                    ? "var(--rose-pale)"
                    : "transparent",
                transition: "transform 0.1s",
              }}
              onMouseEnter={(e) =>
                (e.currentTarget.style.transform = "scale(1.3)")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.transform = "scale(1)")
              }
            >
              {r.emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CommentSection({ postId, onCountChange }) {
  const { user } = useAuth();
  const toast = useToast();
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // GET /api/posts/:id/comments
    api
      .get(`/api/posts/${postId}/comments?page=1&page_size=20`)
      .then((d) => {
        const list = d.comments || [];
        setComments(list);
        onCountChange?.(d.total ?? list.length);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [postId]);

  const submit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    try {
      // POST /api/posts/:id/comments
      const c = await api.post(`/api/posts/${postId}/comments`, {
        content: text.trim(),
      });
      setComments((cs) => [c, ...cs]);
      onCountChange?.((n) => (typeof n === "number" ? n + 1 : 1));
      setText("");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  const deleteComment = async (id) => {
    try {
      // DELETE /api/posts/comments/:id
      await api.delete(`/api/posts/comments/${id}`);
      setComments((cs) => cs.filter((c) => c.id !== id));
      onCountChange?.((n) => (typeof n === "number" ? Math.max(0, n - 1) : 0));
    } catch (err) {
      toast(err.message, "error");
    }
  };

  return (
    <div
      style={{
        padding: "12px 20px 16px",
        borderTop: "1px solid var(--border)",
      }}
    >
      <form
        onSubmit={submit}
        style={{ display: "flex", gap: 10, marginBottom: 12 }}
      >
        <AvatarImg src={user?.avatar_url} name={user?.username} size={30} />
        <input
          className="input-field"
          placeholder="Viết bình luận..."
          value={text}
          onChange={(e) => setText(e.target.value)}
          style={{ padding: "8px 14px", fontSize: 13 }}
        />
        <button
          className="btn btn-primary btn-sm"
          type="submit"
          disabled={submitting || !text.trim()}
        >
          {submitting ? "…" : "↑"}
        </button>
      </form>

      {loading ? (
        <div style={{ textAlign: "center", padding: 8 }}>
          <span className="spinner" style={{ width: 16, height: 16 }} />
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ display: "flex", gap: 10 }}>
              <AvatarImg src={c.avatar_url} name={c.username} size={28} />
              <div style={{ flex: 1 }}>
                <div
                  style={{
                    background: "var(--cream)",
                    borderRadius: 12,
                    padding: "8px 12px",
                    fontSize: 13,
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ fontWeight: 600, marginRight: 6 }}>
                    {c.username}
                  </span>
                  {c.content}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    marginTop: 4,
                    paddingLeft: 12,
                  }}
                >
                  <span style={{ fontSize: 11, color: "var(--ink-ghost)" }}>
                    {timeAgo(c.created_at)}
                  </span>
                  {c.user_id === user?.id && (
                    <button
                      onClick={() => deleteComment(c.id)}
                      style={{
                        fontSize: 11,
                        color: "var(--rose)",
                        background: "none",
                        border: "none",
                        cursor: "pointer",
                      }}
                    >
                      Xóa
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onDelete, openUserProfile }) {
  const { user } = useAuth();
  const toast = useToast();
  const [reactions, setReactions] = useState(post.reactions || {});
  const [showComments, setShowComments] = useState(false);
  const [commentCount, setCommentCount] = useState(post.comment_count || 0);
  const [deleting, setDeleting] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef();

  useEffect(() => {
    const h = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target))
        setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const handleDelete = async () => {
    setMenuOpen(false);
    if (!confirm("Xóa bài viết này?")) return;
    setDeleting(true);
    try {
      // DELETE /api/posts/:id
      await api.delete(`/api/posts/${post.id}`);
      onDelete(post.id);
      toast("Đã xóa bài viết", "success");
    } catch (err) {
      toast(err.message, "error");
      setDeleting(false);
    }
  };

  const isOwner = post.user_id === user?.id;

  return (
    <div className="card" style={{ animation: "fadeUp 0.35s ease" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "16px 20px",
        }}
      >
        <button
          onClick={() => openUserProfile?.(post.user_id)}
          style={{
            background: "none",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
        >
          <AvatarImg src={post.avatar_url} name={post.username} size={42} />
        </button>
        <div style={{ flex: 1 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => openUserProfile?.(post.user_id)}
              style={{
                fontWeight: 700,
                fontSize: 15,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: 0,
                color: "var(--ink)",
              }}
            >
              {post.username}
            </button>
            <SentimentBadge score={post.sentiment_score} />
          </div>
          <span style={{ fontSize: 12, color: "var(--ink-ghost)" }}>
            {timeAgo(post.created_at)}
          </span>
        </div>

        {/* 3-dot menu */}
        <div ref={menuRef} style={{ position: "relative" }}>
          <button
            className="btn btn-ghost btn-icon"
            onClick={() => setMenuOpen((s) => !s)}
            style={{ fontSize: 18, color: "var(--ink-ghost)" }}
          >
            ⋯
          </button>
          {menuOpen && (
            <div
              style={{
                position: "absolute",
                top: "110%",
                right: 0,
                zIndex: 20,
                background: "white",
                borderRadius: 12,
                padding: "6px",
                boxShadow: "var(--shadow-md)",
                border: "1px solid var(--border)",
                minWidth: 160,
                animation: "slideDown 0.15s ease",
              }}
            >
              {isOwner ? (
                <button
                  className="btn btn-ghost"
                  onClick={handleDelete}
                  disabled={deleting}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    color: "var(--rose)",
                    fontSize: 14,
                  }}
                >
                  🗑️ Xóa bài viết
                </button>
              ) : (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setMenuOpen(false);
                    setShowReport(true);
                  }}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    fontSize: 14,
                  }}
                >
                  🚩 Báo cáo bài viết
                </button>
              )}
              {!isOwner && (
                <button
                  className="btn btn-ghost"
                  onClick={() => {
                    setMenuOpen(false);
                    openUserProfile?.(post.user_id);
                  }}
                  style={{
                    width: "100%",
                    justifyContent: "flex-start",
                    fontSize: 14,
                  }}
                >
                  👤 Xem hồ sơ
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Content */}
      {post.content && (
        <div
          style={{
            padding: "0 20px 16px",
            fontSize: 15,
            lineHeight: 1.75,
            color: "var(--ink-mid)",
          }}
        >
          {post.content}
        </div>
      )}

      {/* Media */}
      {post.media_urls?.length > 0 && (
        <div>
          {post.media_type === "image" && (
            <img
              src={resolveMediaUrl(post.media_urls[0])}
              alt=""
              style={{ width: "100%", maxHeight: 500, objectFit: "cover" }}
            />
          )}
          {post.media_type === "video" && (
            <video
              src={resolveMediaUrl(post.media_urls[0])}
              controls
              style={{ width: "100%", maxHeight: 480 }}
            />
          )}
        </div>
      )}

      {/* Reaction counts */}
      {REACTIONS.some((r) => reactions[r.key] > 0) && (
        <div
          style={{
            padding: "8px 20px 0",
            display: "flex",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          {REACTIONS.filter((r) => reactions[r.key] > 0).map((r) => (
            <span
              key={r.key}
              style={{ fontSize: 13, color: "var(--ink-soft)" }}
            >
              {r.emoji} {reactions[r.key]}
            </span>
          ))}
        </div>
      )}

      {/* Action bar */}
      <div
        style={{
          display: "flex",
          gap: 4,
          padding: "8px 12px",
          borderTop: "1px solid var(--border)",
          marginTop: 8,
        }}
      >
        <ReactionBar
          reactions={reactions}
          postId={post.id}
          onUpdate={setReactions}
        />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => setShowComments((s) => !s)}
          style={{ color: showComments ? "var(--rose)" : "var(--ink-soft)" }}
        >
          💬 {commentCount > 0 ? commentCount : ""} Bình luận
        </button>
      </div>

      {/* Comments */}
      {showComments && (
        <CommentSection postId={post.id} onCountChange={setCommentCount} />
      )}

      {/* Report modal */}
      {showReport && (
        <ReportModal
          targetId={post.id}
          targetType="post"
          targetName={`bài viết của @${post.username}`}
          onClose={() => setShowReport(false)}
        />
      )}
    </div>
  );
}

function CreatePost({ onPost }) {
  const { user } = useAuth();
  const toast = useToast();
  const [content, setContent] = useState("");
  const [mediaUrl, setMediaUrl] = useState(null);
  const [mediaType, setMediaType] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef();

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    console.info("[create-post] selected file", {
      name: file.name,
      type: file.type,
      size: file.size,
      sizeText: formatBytes(file.size),
    });

    if (!ALLOWED_UPLOAD_TYPES.includes(file.type)) {
      toast(
        "File không hợp lệ. Chỉ hỗ trợ JPEG/PNG/WEBP/GIF/MP4/WEBM/MOV.",
        "error",
      );
      e.target.value = "";
      return;
    }

    const maxSize = ALLOWED_VIDEO_TYPES.includes(file.type)
      ? MAX_VIDEO_SIZE_BYTES
      : MAX_IMAGE_SIZE_BYTES;
    if (file.size > maxSize) {
      const label = ALLOWED_VIDEO_TYPES.includes(file.type) ? "50MB" : "10MB";
      toast(`File vượt quá ${label} (${formatBytes(file.size)}).`, "error");
      e.target.value = "";
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);

      console.info("[create-post] upload endpoint", "/api/posts/upload-media");
      // POST /api/posts/upload-media
      const res = await api.postForm("/api/posts/upload-media", fd);

      console.info("[create-post] upload response", res);
      if (!res?.url || !res?.media_type) {
        throw new Error(
          "Upload thành công nhưng response thiếu url/media_type.",
        );
      }

      setMediaUrl(res.url);
      setMediaType(res.media_type);
      if (!res?.public_id) {
        console.warn("[create-post] upload response missing public_id", res);
      }
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const submit = async () => {
    if (!content.trim() && !mediaUrl) return;
    setSubmitting(true);
    try {
      const payload = {
        content: content.trim(),
        media_urls: mediaUrl ? [mediaUrl] : [],
        media_type: mediaType ? String(mediaType).toLowerCase() : null,
      };

      console.info("[create-post] create endpoint", "/api/posts");
      console.info("[create-post] create payload", payload);
      console.info("[create-post] mediaUrl state", mediaUrl);
      console.info("[create-post] mediaType state", mediaType);

      // POST /api/posts
      const post = await api.post("/api/posts", payload);

      console.info("[create-post] create response", post);
      onPost(post);
      setContent("");
      setMediaUrl(null);
      setMediaType(null);
      toast("Đã đăng bài! Aura đang phân tích cảm xúc ✨", "success");
    } catch (err) {
      toast(err.message, "error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="card" style={{ padding: 20, marginBottom: 20 }}>
      <div style={{ display: "flex", gap: 12 }}>
        <AvatarImg src={user?.avatar_url} name={user?.username} size={42} />
        <div style={{ flex: 1 }}>
          <textarea
            className="input-field"
            placeholder={`${user?.username} ơi, bạn đang nghĩ gì vậy?`}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            rows={3}
            style={{ marginBottom: 10 }}
          />

          {mediaUrl && (
            <div
              style={{
                position: "relative",
                marginBottom: 10,
                display: "inline-block",
              }}
            >
              {mediaType === "image" ? (
                <img
                  src={mediaUrl}
                  alt=""
                  style={{
                    maxHeight: 200,
                    borderRadius: 10,
                    objectFit: "cover",
                    display: "block",
                  }}
                />
              ) : (
                <video
                  src={mediaUrl}
                  controls
                  style={{
                    maxHeight: 200,
                    borderRadius: 10,
                    width: "100%",
                    display: "block",
                  }}
                />
              )}
              <button
                onClick={() => {
                  setMediaUrl(null);
                  setMediaType(null);
                }}
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  background: "rgba(0,0,0,0.55)",
                  color: "white",
                  border: "none",
                  borderRadius: "50%",
                  width: 24,
                  height: 24,
                  cursor: "pointer",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                ✕
              </button>
            </div>
          )}

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <span className="spinner" style={{ width: 14, height: 14 }} />
              ) : (
                "📷"
              )}{" "}
              Ảnh/Video
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime"
              style={{ display: "none" }}
              onChange={handleFile}
            />
            <button
              className="btn btn-primary"
              onClick={submit}
              disabled={submitting || (!content.trim() && !mediaUrl)}
            >
              {submitting ? (
                <span className="spinner" style={{ width: 16, height: 16 }} />
              ) : (
                "✨ Đăng bài"
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function FeedPage({ openUserProfile, setPage, setChatMatch }) {
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [curPage, setCurPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [matches, setMatches] = useState([]);
  const [matchesLoading, setMatchesLoading] = useState(true);
  const toast = useToast();
  const postSectionRef = useRef(null);

  const loadPosts = useCallback(
    async (pg = 1, append = false) => {
      pg === 1 ? setLoading(true) : setLoadingMore(true);
      try {
        // GET /api/posts/feed?page=N&page_size=15
        const data = await api.get(`/api/posts/feed?page=${pg}&page_size=15`);
        const fetched = data.posts || [];
        setPosts((p) => (append ? [...p, ...fetched] : fetched));
        setHasMore(fetched.length === 15);
        setCurPage(pg);
      } catch (err) {
        toast(err.message, "error");
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [toast],
  );

  useEffect(() => {
    loadPosts(1);
  }, [loadPosts]);

  useEffect(() => {
    setMatchesLoading(true);
    api
      .get("/api/match/me")
      .then((d) => setMatches(Array.isArray(d) ? d : []))
      .catch(() => setMatches([]))
      .finally(() => setMatchesLoading(false));
  }, []);

  const scrollToCreatePost = () => {
    postSectionRef.current?.scrollIntoView({
      behavior: "smooth",
      block: "start",
    });
  };

  const openMatchChat = (match) => {
    if (!setChatMatch || !setPage) return;
    setChatMatch({
      id: match.id,
      name: match.user2_username,
      avatar_url: match.user2_avatar_url,
    });
    setPage("messages");
  };

  return (
    <div style={{ maxWidth: 1120, margin: "0 auto", padding: "24px 20px" }}>
      <div style={{ marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, color: "var(--rose)", marginBottom: 4 }}>
          Trang chủ
        </h1>
        <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>
          Đọc tin, đăng bài và nhắn nhanh với bạn ghép đôi.
        </p>
      </div>

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 560px", minWidth: 320, maxWidth: 760 }}>
          <div
            style={{
              overflowX: "auto",
              display: "flex",
              gap: 12,
              paddingBottom: 12,
              marginBottom: 20,
            }}
          >
            <button
              type="button"
              className="btn btn-secondary"
              style={{
                minWidth: 88,
                height: 102,
                borderRadius: 22,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                whiteSpace: "nowrap",
              }}
            >
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--rose-pale)",
                  color: "var(--rose)",
                  fontSize: 24,
                }}
              >
                +
              </div>
              <span style={{ fontSize: 12, color: "var(--ink)", fontWeight: 700 }}>
                Thêm tin
              </span>
            </button>
            {matches.slice(0, 5).map((m) => (
              <div
                key={m.id}
                style={{
                  minWidth: 88,
                  height: 102,
                  borderRadius: 22,
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 10,
                  gap: 8,
                  cursor: "pointer",
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: "50%",
                    overflow: "hidden",
                    border: "2px solid var(--rose)",
                  }}
                >
                  <AvatarImg
                    src={m.user2_avatar_url}
                    name={m.user2_username}
                    size={52}
                  />
                </div>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--ink)",
                    textAlign: "center",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    width: 72,
                  }}
                >
                  {m.user2_username}
                </span>
              </div>
            ))}
          </div>

          <div className="card" style={{ padding: 20, marginBottom: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontSize: 20,
                    fontWeight: 700,
                    color: "var(--rose)",
                    marginBottom: 8,
                  }}
                >
                  Đăng tin nhanh
                </div>
                <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 14 }}>
                  Chia sẻ trạng thái, ảnh hoặc video để mọi người kết nối cùng bạn.
                </p>
              </div>
              <button
                className="btn btn-primary"
                onClick={scrollToCreatePost}
                style={{ whiteSpace: "nowrap" }}
              >
                Đăng tin ngay
              </button>
            </div>
          </div>

          <div ref={postSectionRef}>
            <CreatePost onPost={(p) => setPosts((prev) => [p, ...prev])} />
          </div>
        </div>

        <aside
          style={{
            flex: "0 0 300px",
            minWidth: 280,
            maxWidth: 320,
            alignSelf: "flex-start",
          }}
        >
          <div className="card" style={{ padding: 20 }}>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 16,
              }}
            >
              <div>
                <div style={{ fontSize: 16, fontWeight: 700 }}>
                  Bạn bè đang hoạt động
                </div>
                <p style={{ margin: 0, color: "var(--ink-soft)", fontSize: 13 }}>
                  Nhấn vào để chat ngay.
                </p>
              </div>
              <span
                style={{
                  fontSize: 12,
                  color: "var(--ink-soft)",
                  padding: "4px 10px",
                  borderRadius: 999,
                  background: "var(--surface-container)",
                }}
              >
                {matchesLoading
                  ? "..."
                  : `${matches.filter((item) => item.partner_is_online).length} online`}
              </span>
            </div>

            {matchesLoading ? (
              <div className="page-loader" style={{ padding: 18 }}>
                <span className="spinner" />
              </div>
            ) : matches.length === 0 ? (
              <div
                className="empty-state"
                style={{ padding: 18, borderRadius: 16 }}
              >
                <div style={{ fontSize: 22, marginBottom: 8 }}>💔</div>
                <p style={{ margin: 0, color: "var(--ink-soft)" }}>
                  Chưa có ai ghép đôi. Hãy đăng bài và tương tác ngay.
                </p>
              </div>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {matches.slice(0, 6).map((m) => (
                  <button
                    key={m.id}
                    onClick={() => openMatchChat(m)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 12,
                      width: "100%",
                      padding: "12px 14px",
                      borderRadius: 16,
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    <div style={{ position: "relative" }}>
                      <AvatarImg
                        src={m.user2_avatar_url}
                        name={m.user2_username}
                        size={40}
                      />
                      {m.partner_is_online && (
                        <div
                          style={{
                            position: "absolute",
                            bottom: 0,
                            right: 0,
                            width: 10,
                            height: 10,
                            borderRadius: "50%",
                            background: "#22c55e",
                            border: "2px solid var(--surface)",
                          }}
                        />
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: 14,
                          fontWeight: 700,
                          marginBottom: 4,
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.user2_username}
                      </div>
                      <div
                        style={{
                          fontSize: 12,
                          color: "var(--ink-soft)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {m.user2_bio || (m.partner_is_online ? "Trực tuyến" : "Ngoại tuyến")}
                      </div>
                    </div>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: 12,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        background: "rgba(226, 88, 121, 0.14)",
                      }}
                    >
                      <span style={{ color: "var(--rose)", fontSize: 16 }}>💬</span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>

      {loading ? (
        <div className="page-loader">
          <span className="spinner" />
        </div>
      ) : posts.length === 0 ? (
        <div className="empty-state">
          <div style={{ fontSize: 48, marginBottom: 16 }}>🌸</div>
          <h3>Chưa có bài viết nào</h3>
          <p>Hãy là người đầu tiên chia sẻ cảm xúc của bạn!</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {posts.map((p, i) => (
            <div
              key={p.id}
              style={{ animationDelay: `${Math.min(i, 5) * 0.05}s` }}
            >
              <PostCard
                post={p}
                onDelete={(id) =>
                  setPosts((prev) => prev.filter((x) => x.id !== id))
                }
                openUserProfile={openUserProfile}
              />
            </div>
          ))}
          {hasMore && (
            <div style={{ textAlign: "center", padding: 16 }}>
              <button
                className="btn btn-secondary"
                onClick={() => loadPosts(curPage + 1, true)}
                disabled={loadingMore}
              >
                {loadingMore ? (
                  <span className="spinner" style={{ width: 16, height: 16 }} />
                ) : (
                  "Xem thêm bài viết"
                )}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
