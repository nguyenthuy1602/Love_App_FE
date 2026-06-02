import { useState, useCallback, useEffect } from "react";
import { useAuth } from "./AuthContext";
import { useToast } from "./ToastContext";
import { useNotifications } from "./useNotifications";
import { Sidebar } from "./Sidebar";
import { LoginPage, RegisterPage } from "./AuthPages";
import { FeedPage } from "./pages/FeedPage";
import { MatchPage } from "./pages/MatchPage";
import { MessagesPage } from "./pages/MessagesPage";
import { ProfilePage } from "./pages/ProfilePage";
import { AboutPage } from "./pages/About";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import { api } from "./api";

function AppInner() {
  const { user, loading } = useAuth();
  const toast = useToast();
  const [authMode, setAuthMode] = useState("login");
  const [page, setPage] = useState("feed");
  const [chatMatch, setChatMatch] = useState(null);
  const [notifCount, setNotifCount] = useState(0);
  // viewProfile: { id } để xem profile người khác
  const [viewProfile, setViewProfile] = useState(null);

  const navigate = useNavigate();
  const location = useLocation();

  // Keep URL and internal page state in sync. Only lightweight routing added — UI unchanged.
  useEffect(() => {
    const p = location.pathname || "/";
    if (p === "/" || p === "") {
      setPage("feed");
      setChatMatch(null);
      return;
    }
    if (p.startsWith("/messages/")) {
      setPage("messages");
      const id = p.replace("/messages/", "");
      if (id) {
        // try to fetch match info to populate chatMatch (best-effort, non-blocking)
        api
          .get(`/api/match/${id}`)
          .then((d) => {
            if (d && d.id) {
              setChatMatch({
                id: d.id,
                name: d.user2_username || d.name || "",
                avatar_url: d.user2_avatar_url || d.avatar_url || null,
              });
            } else {
              setChatMatch({ id });
            }
          })
          .catch(() => setChatMatch({ id }));
      }
      return;
    }
    if (p.startsWith("/match")) {
      setPage("match");
      return;
    }
    if (p.startsWith("/profile")) {
      setPage("profile");
      return;
    }
    if (p.startsWith("/about")) {
      setPage("about");
      return;
    }
  }, [location.pathname]);

  const handleNotif = useCallback(
    (notif) => {
      if (notif.type === "new_match") {
        toast(`💘 ${notif.from_username} đã thích bạn!`, "success");
        setNotifCount((n) => n + 1);
      } else if (notif.type === "new_message") {
        toast(
          `💬 ${notif.sender_username}: ${(notif.content || "").slice(0, 50)}`,
          "info",
        );
        setNotifCount((n) => n + 1);
      } else if (notif.type === "new_comment") {
        toast(
          `💬 ${notif.from_username} đã bình luận bài viết của bạn`,
          "info",
        );
      } else if (notif.type === "new_reaction") {
        toast(`❤️ ${notif.from_username} đã react bài viết của bạn`, "info");
      }
    },
    [toast],
  );

  useNotifications(user, handleNotif);

  if (loading) {
    return (
      <div
        style={{
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, var(--rose), var(--rose-light))",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 24,
            animation: "float 2s ease-in-out infinite",
            boxShadow: "0 8px 24px rgba(232,54,74,0.3)",
          }}
        >
          ❤️
        </div>
        <p style={{ color: "var(--ink-soft)", fontSize: 14 }}>Đang tải...</p>
      </div>
    );
  }

  if (!user) {
    return authMode === "login" ? (
      <LoginPage onSwitch={() => setAuthMode("register")} />
    ) : (
      <RegisterPage onSwitch={() => setAuthMode("login")} />
    );
  }

  const handleSetPage = (p) => {
    setPage(p);
    if (p === "messages") setNotifCount(0);
    if (p !== "messages") setChatMatch(null);
    if (p !== "profile") setViewProfile(null);
    // mirror in URL for deep links
    try {
      if (p === "feed") navigate("/");
      else if (p === "match") navigate("/match");
      else if (p === "messages") navigate("/messages");
      else if (p === "profile") navigate("/profile");
      else if (p === "about") navigate("/about");
    } catch (e) {}
  };

  const openUserProfile = (userId) => {
    setViewProfile({ id: userId });
    setPage("profile");
  };

  return (
    <div style={{ display: "flex", minHeight: "100vh" }}>
      <Sidebar page={page} setPage={handleSetPage} notifCount={notifCount} />
      <main
        style={{
          flex: 1,
          marginLeft: 72,
          minHeight: "100vh",
          background: "var(--cream)",
          overflow: page === "messages" && chatMatch ? "hidden" : "auto",
        }}
      >
        {page === "feed" && (
          <FeedPage
            openUserProfile={openUserProfile}
            setPage={handleSetPage}
            setChatMatch={setChatMatch}
          />
        )}
        {page === "match" && (
          <MatchPage
            setPage={handleSetPage}
            setChatMatch={setChatMatch}
            openUserProfile={openUserProfile}
          />
        )}
        {page === "messages" && (
          <MessagesPage chatMatch={chatMatch} setChatMatch={setChatMatch} />
        )}
        {page === "profile" && (
          <ProfilePage
            viewUserId={viewProfile?.id || null}
            onBack={() => {
              setViewProfile(null);
            }}
          />
        )}
        {page === "about" && <AboutPage onClose={() => setPage("feed")} />}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AppInner />
    </BrowserRouter>
  );
}
