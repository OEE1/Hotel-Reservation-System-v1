"use client";

import { ArrowRightOnRectangleIcon } from "@heroicons/react/24/solid";
import { signOutAction } from "../../lib/actions";
import { clearCachedSession } from "@/lib/auth/sessionStorageAuth";
import { resetAuthToUnauthenticated } from "@/store/authSessionStore";
import { clearAllChatDrafts } from "@/lib/chat/chatDraftStorage";
import { clearChatPersistence } from "@/lib/chat/chatPersistence";
import { useChatStore } from "@/store/chatStore";

async function handleSignOut(e) {
  e.preventDefault();
  await clearChatPersistence();
  clearAllChatDrafts();
  useChatStore.getState().clearAllConversations();
  clearCachedSession();
  resetAuthToUnauthenticated();
  await signOutAction();
}

function SignOutButton() {
  return (
    <form onSubmit={handleSignOut}>
      <button
        type="submit"
        className="py-3 px-5 hover:bg-primary-900 hover:text-primary-100 transition-colors flex items-center gap-4 font-semibold text-primary-200 w-full"
      >
        <ArrowRightOnRectangleIcon className="h-5 w-5 text-primary-600" />
        <span>Sign out</span>
      </button>
    </form>
  );
}

export default SignOutButton;
