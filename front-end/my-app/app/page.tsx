"use client";

import { useState } from "react";
import AuthScreen from "../components/AuthScreen";
import WorkspaceView from "../components/WorkspaceView";
import { useAuthSession } from "../hooks/useAuthSession";

export default function Home() {
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const auth = useAuthSession({ setBusy, setFeedback });

  if (!auth.token || !auth.currentUser) {
    return (
      <AuthScreen
        setupStatus={auth.setupStatus}
        bootstrapForm={auth.bootstrapForm}
        setBootstrapForm={auth.setBootstrapForm}
        loginForm={auth.loginForm}
        setLoginForm={auth.setLoginForm}
        handleBootstrapAdmin={auth.handleBootstrapAdmin}
        handleLogin={auth.handleLogin}
        busy={busy}
        feedback={feedback}
      />
    );
  }

  return (
    <WorkspaceView
      token={auth.token}
      currentUser={auth.currentUser}
      apiRequest={auth.apiRequest}
      refreshAccessToken={auth.refreshAccessToken}
      handleLogout={auth.handleLogout}
      busy={busy}
      setBusy={setBusy}
      feedback={feedback}
      setFeedback={setFeedback}
    />
  );
}
