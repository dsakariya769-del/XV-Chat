import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, deleteUser, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, collection,
  query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp,
  getDocs, increment
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

let authMode = "login";
let me = null;
let currentChat = null;
let currentPeer = null;
let chatsUnsub = null;
let messagesUnsub = null;
let typingTimer = null;
let replyingTo = null;
let isCreatingAccount = false;

function escapeHTML(s = "") {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function initials(s = "XV") {
  return s.slice(0, 2).toUpperCase();
}

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  setTimeout(() => t.classList.add("hidden"), 2500);
}

function formatTime(ts) {
  if (!ts?.toDate) return "";
  return ts.toDate().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function chatId(a, b) {
  return [a, b].sort().join("_");
}

function showMain() {
  $("#authView").classList.add("hidden");
  $("#mainView").classList.remove("hidden");

  $("#profileName").textContent = me.username;
  $("#profileXVId").textContent = me.xvId;
  $("#profileAvatar").textContent = initials(me.username);

  subscribeChats();
}

function showAuth() {
  $("#mainView").classList.add("hidden");
  $("#chatView").classList.add("hidden");
  $("#authView").classList.remove("hidden");

  if (chatsUnsub) chatsUnsub();
  if (messagesUnsub) messagesUnsub();
}

function setAuthMode(mode) {
  authMode = mode;

  $$(".tab").forEach(x =>
    x.classList.toggle("active", x.dataset.mode === mode)
  );

  $("#usernameWrap").classList.toggle("hidden", mode !== "signup");
  $("#authSubmit").textContent =
    mode === "signup" ? "Create account" : "Login";

  $("#authError").textContent = "";
}

$$(".tab").forEach(b => {
  b.onclick = () => setAuthMode(b.dataset.mode);
});


/* =========================
   AUTH / SIGNUP
========================= */

$("#authForm").addEventListener("submit", async e => {
  e.preventDefault();

  const email = $("#email").value.trim();
  const password = $("#password").value;

  try {

    /* LOGIN */
    if (authMode === "login") {

      await signInWithEmailAndPassword(
        auth,
        email,
        password
      );

    }

    /* SIGNUP */
    else {

      const username = $("#username")
        .value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_.]/g, "");

      if (username.length < 3) {
        throw new Error(
          "Username must have at least 3 valid characters."
        );
      }

      /*
       * IMPORTANT:
       * Create Firebase Authentication account FIRST.
       * After this succeeds, request.auth exists,
       * so Firestore username lookup is allowed.
       */

      isCreatingAccount = true;

      const cred = await createUserWithEmailAndPassword(
        auth,
        email,
        password
      );

      const uid = cred.user.uid;

      try {

        /* Check username AFTER authentication */

        const xvId =
  "XV-" + uid.slice(0, 8).toUpperCase();

await setDoc(
  doc(db, "users", uid),
  {
    username,
    xvId,
    email,
    createdAt: serverTimestamp(),
    online: true,
    lastSeen: serverTimestamp(),
    privacy: {
      readReceipts: true
    }
  }
);

        /*
         * Keep local user data ready immediately.
         * This also prevents the auth-state listener
         * from racing with profile creation.
         */

        me = {
          uid,
          username,
          xvId,
          email,
          createdAt: null,
          online: true,
          lastSeen: null,
          privacy: {
            readReceipts: true
          }
        };

        isCreatingAccount = false;

        showMain();

      } catch (err) {

        /*
         * If Firestore profile creation fails,
         * remove the newly-created Auth account
         * so no half-created account remains.
         */

        isCreatingAccount = false;

        try {
          await deleteUser(cred.user);
        } catch (_) {}

        throw err;
      }
    }

  } catch (err) {

    isCreatingAccount = false;

    $("#authError").textContent =
      err.message.replace("Firebase: ", "");
  }
});


/* =========================
   AUTH STATE
========================= */

onAuthStateChanged(auth, async user => {

  /*
   * During signup we handle the user manually above.
   * This prevents a race between Auth and Firestore.
   */

  if (isCreatingAccount) return;

  if (!user) {
    me = null;
    showAuth();
    return;
  }

  const snap = await getDoc(
    doc(db, "users", user.uid)
  );

  if (!snap.exists()) {
    await signOut(auth);
    return;
  }

  me = {
    uid: user.uid,
    ...snap.data()
  };

  await updateDoc(
    doc(db, "users", user.uid),
    {
      online: true,
      lastSeen: serverTimestamp()
    }
  );

  showMain();
});


/* =========================
   CHATS
========================= */

function subscribeChats() {

  if (chatsUnsub) chatsUnsub();

  chatsUnsub = onSnapshot(
    query(
      collection(db, "chats"),
      where("participants", "array-contains", me.uid)
    ),
    async snap => {

      const rows = [];

      for (const d of snap.docs) {

        const c = d.data();

        const peerId =
          c.participants.find(x => x !== me.uid);

        if (!peerId) continue;

        const peer = await getDoc(
          doc(db, "users", peerId)
        );

        if (!peer.exists()) continue;

        rows.push({
          id: d.id,
          ...c,
          peerId,
          peer: peer.data()
        });
      }

      rows.sort(
        (a, b) =>
          (b.lastMessageAt?.seconds || 0) -
          (a.lastMessageAt?.seconds || 0)
      );

      renderChats(rows);
    }
  );
}


function renderChats(rows) {

  const list = $("#chatList");

  list.innerHTML = "";

  $("#emptyChats").classList.toggle(
    "hidden",
    rows.length > 0
  );

  rows.forEach(c => {

    const div = document.createElement("button");

    div.className = "chat-row";

    div.innerHTML = `
      <div class="avatar">
        ${escapeHTML(initials(c.peer.username))}
      </div>

      <div class="chat-info">
        <b>${escapeHTML(c.peer.username)}</b>
        <p>
          ${escapeHTML(
            c.lastMessage?.text ||
            "Start a conversation"
          )}
        </p>
      </div>

      <div class="chat-meta">
        ${formatTime(c.lastMessageAt)}

        ${
          c.unread?.[me.uid]
            ? `<span class="unread">
                ${c.unread[me.uid]}
              </span>`
            : ""
        }
      </div>
    `;

    div.onclick = () =>
      openChat(
        c.id,
        c.peerId,
        c.peer
      );

    list.appendChild(div);
  });
}


/* =========================
   USER SEARCH
========================= */

$("#userSearch").addEventListener(
  "input",
  async e => {

    const term =
      e.target.value.trim().toLowerCase();

    const box = $("#userResults");

    box.innerHTML = "";

    if (term.length < 2) return;

    const q1 = query(
      collection(db, "users"),
      where("username", ">=", term),
      where("username", "<=", term + "\uf8ff"),
      limit(10)
    );

    const snaps = await getDocs(q1);

    snaps.docs
      .filter(d => d.id !== me.uid)
      .forEach(d => {

        const u = {
          uid: d.id,
          ...d.data()
        };

        const b = document.createElement("button");

        b.className = "user-row";

        b.innerHTML = `
          <div class="avatar">
            ${initials(u.username)}
          </div>

          <div class="chat-info">
            <b>${escapeHTML(u.username)}</b>
            <p>${escapeHTML(u.xvId)}</p>
          </div>

          <span>
            ${u.online ? "🟢" : "⚪"}
          </span>
        `;

        b.onclick = () =>
          openChat(
            chatId(me.uid, u.uid),
            u.uid,
            u
          );

        box.appendChild(b);
      });
  }
);


/* =========================
   OPEN CHAT
========================= */

async function openChat(id, peerId, peer) {

  currentChat = id;

  currentPeer = {
    uid: peerId,
    ...peer
  };

  $("#mainView").classList.add("hidden");
  $("#chatView").classList.remove("hidden");

  $("#chatTitle").textContent =
    peer.username;

  $("#chatAvatar").textContent =
    initials(peer.username);

  $("#presenceText").textContent =
    peer.online ? "Online" : "Offline";

  const ref = doc(db, "chats", id);

  const cs = await getDoc(ref);

  if (!cs.exists()) {

    await setDoc(
      ref,
      {
        participants: [
          me.uid,
          peerId
        ],
        createdAt: serverTimestamp(),
        unread: {
          [me.uid]: 0,
          [peerId]: 0
        }
      }
    );
  }

  await updateDoc(
    ref,
    {
      [`unread.${me.uid}`]: 0
    }
  );

  if (messagesUnsub)
    messagesUnsub();

  messagesUnsub = onSnapshot(
    query(
      collection(
        db,
        "chats",
        id,
        "messages"
      ),
      orderBy("createdAt", "asc")
    ),
    snap => {

      const messages =
        snap.docs.map(d => ({
          id: d.id,
          ...d.data()
        }));

      renderMessages(messages);

      snap.docs
        .filter(
          d =>
            d.data().senderId !== me.uid &&
            d.data().status !== "seen"
        )
        .forEach(
          async d =>
            updateDoc(
              d.ref,
              {
                status: "seen"
              }
            )
        );
    }
  );

  onSnapshot(
    doc(db, "users", peerId),
    s => {

      if (!s.exists()) return;

      const data = s.data();

      $("#presenceText").textContent =
        data.online
          ? "Online"
          : (
              data.lastSeen?.toDate
                ? `Last seen ${data.lastSeen
                    .toDate()
                    .toLocaleString()}`
                : "Offline"
            );
    }
  );
}


/* =========================
   MESSAGES
========================= */

function renderMessages(msgs) {

  const box = $("#messages");

  const nearBottom =
    box.scrollHeight -
    box.scrollTop -
    box.clientHeight < 120;

  box.innerHTML = "";

  msgs.forEach(m => {

    const d =
      document.createElement("div");

    d.className =
      "message " +
      (
        m.senderId === me.uid
          ? "out"
          : "in"
      );

    const reply =
      m.replyTo
        ? `
          <div class="reply-preview">
            ↩ ${escapeHTML(
              m.replyTo.text || "Message"
            )}
          </div>
        `
        : "";

    const reactions =
      m.reactions
        ? `
          <div class="reaction-line">
            ${Object.values(m.reactions).join(" ")}
          </div>
        `
        : "";

    d.innerHTML = `
      ${reply}

      <div>
        ${escapeHTML(
          m.text ||
          m.sticker ||
          ""
        )}
      </div>

      ${reactions}

      <div class="meta">
        ${formatTime(m.createdAt)}

        ${
          m.senderId === me.uid
            ? (
                {
                  sent: "✓",
                  delivered: "✓✓",
                  seen: "✓✓"
                }[m.status] || "✓"
              )
            : ""
        }
      </div>
    `;

    d.onclick = () =>
      messageMenu(m);

    box.appendChild(d);
  });

  if (nearBottom) {

    setTimeout(
      () =>
        box.scrollTop =
          box.scrollHeight,
      20
    );
  }
}


/* =========================
   SEND MESSAGE
========================= */

async function sendMessage(
  text,
  sticker = null
) {

  if (
    !currentChat ||
    (!text && !sticker)
  ) return;

  const ref =
    doc(
      db,
      "chats",
      currentChat
    );

  const msg = {

    senderId: me.uid,

    text: text || "",

    sticker: sticker || "",

    createdAt:
      serverTimestamp(),

    status: "sent",

    replyTo:
      replyingTo
        ? {
            id: replyingTo.id,
            text:
              replyingTo.text ||
              replyingTo.sticker ||
              "Sticker"
          }
        : null,

    reactions: {}
  };

  await addDoc(
    collection(
      db,
      "chats",
      currentChat,
      "messages"
    ),
    msg
  );

  await updateDoc(
    ref,
    {
      lastMessage: {
        text:
          text ||
          sticker ||
          "Sticker",
        senderId: me.uid
      },

      lastMessageAt:
        serverTimestamp(),

      [`unread.${currentPeer.uid}`]:
        increment(1)
    }
  );

  replyingTo = null;

  $("#replyBar")
    .classList
    .add("hidden");

  $("#messageInput").value = "";

  $("#messageInput")
    .style
    .height = "auto";
}


$("#sendBtn").onclick = () =>
  sendMessage(
    $("#messageInput")
      .value
      .trim()
  );


$("#messageInput")
  .addEventListener(
    "keydown",
    e => {

      if (
        e.key === "Enter" &&
        !e.shiftKey
      ) {

        e.preventDefault();

        sendMessage(
          e.target.value.trim()
        );
      }
    }
  );


$("#messageInput")
  .addEventListener(
    "input",
    async () => {

      const el =
        $("#messageInput");

      el.style.height = "auto";

      el.style.height =
        Math.min(
          el.scrollHeight,
          100
        ) + "px";

      if (!currentChat)
        return;

      const chatRef =
        doc(
          db,
          "chats",
          currentChat
        );

      await updateDoc(
        chatRef,
        {
          [`typing.${me.uid}`]:
            true
        }
      );

      clearTimeout(
        typingTimer
      );

      typingTimer =
        setTimeout(
          () =>
            updateDoc(
              chatRef,
              {
                [`typing.${me.uid}`]:
                  false
              }
            ),
          1200
        );
    }
  );


/* =========================
   CHAT CONTROLS
========================= */

$("#backBtn").onclick = () => {

  $("#chatView")
    .classList
    .add("hidden");

  $("#mainView")
    .classList
    .remove("hidden");

  if (messagesUnsub)
    messagesUnsub();

  currentChat = null;
};


$("#stickerBtn").onclick = () =>
  $("#stickerPanel")
    .classList
    .toggle("hidden");


$$(".sticker-panel button")
  .forEach(b => {

    b.onclick = () => {

      sendMessage(
        "",
        b.textContent
      );

      $("#stickerPanel")
        .classList
        .add("hidden");
    };
  });


$("#cancelReply").onclick = () => {

  replyingTo = null;

  $("#replyBar")
    .classList
    .add("hidden");
};


/* =========================
   MESSAGE MENU
========================= */

function messageMenu(m) {

  $("#modalContent").innerHTML = `
    <h3>Message</h3>

    <p>Select an action</p>

    <div class="reaction-picker">
      <button data-r="❤️">❤️</button>
      <button data-r="👍">👍</button>
      <button data-r="😂">😂</button>
      <button data-r="😮">😮</button>
    </div>

    <div class="modal-actions">

      <button
        class="secondary"
        id="replyAction">
        Reply
      </button>

      <button
        class="secondary"
        id="copyAction">
        Copy
      </button>

      ${
        m.senderId === me.uid
          ? `
            <button
              class="danger-btn"
              id="deleteAction">
              Delete
            </button>
          `
          : ""
      }

    </div>
  `;

  $("#modal")
    .classList
    .remove("hidden");


  $("#replyAction").onclick = () => {

    replyingTo = m;

    $("#replyText")
      .textContent =
      m.text || m.sticker;

    $("#replyBar")
      .classList
      .remove("hidden");

    closeModal();

    $("#messageInput")
      .focus();
  };


  $("#copyAction").onclick =
    async () => {

      await navigator.clipboard
        .writeText(
          m.text ||
          m.sticker ||
          ""
        );

      toast("Copied");

      closeModal();
    };


  $$(".reaction-picker button")
    .forEach(b => {

      b.onclick = async () => {

        await updateDoc(
          doc(
            db,
            "chats",
            currentChat,
            "messages",
            m.id
          ),
          {
            [`reactions.${me.uid}`]:
              b.dataset.r
          }
        );

        closeModal();
      };
    });


  const del =
    $("#deleteAction");

  if (del) {

    del.onclick =
      async () => {

        await updateDoc(
          doc(
            db,
            "chats",
            currentChat,
            "messages",
            m.id
          ),
          {
            text:
              "This message was deleted",

            sticker: "",

            deleted: true
          }
        );

        closeModal();
      };
  }
}


function closeModal() {

  $("#modal")
    .classList
    .add("hidden");

  $("#modalContent")
    .innerHTML = "";
}


$("#modal").onclick = e => {

  if (e.target.id === "modal")
    closeModal();
};


/* =========================
   SEARCH / NAVIGATION
========================= */

$("#chatSearch")
  .addEventListener(
    "input",
    e => {

      const term =
        e.target.value
          .toLowerCase();

      $$(".chat-row")
        .forEach(r =>
          r.classList.toggle(
            "hidden",
            !r.textContent
              .toLowerCase()
              .includes(term)
          )
        );
    }
  );


$("#newChatBtn").onclick = () => {

  $('[data-page="contactsPage"]')
    .click();

  $("#userSearch")
    .focus();
};


$$(".nav")
  .forEach(b => {

    b.onclick = () => {

      $$(".nav")
        .forEach(x =>
          x.classList.remove(
            "active"
          )
        );

      b.classList.add("active");

      $$(".page")
        .forEach(p =>
          p.classList.remove(
            "active"
          )
        );

      $("#" + b.dataset.page)
        .classList
        .add("active");
    };
  });


/* =========================
   PROFILE
========================= */

$("#logoutBtn").onclick =
  () => signOut(auth);


$("#copyXVId").onclick =
  async () => {

    await navigator.clipboard
      .writeText(me.xvId);

    toast("XV ID copied!");
  };


$("#deleteAccountBtn").onclick =
  () => {

    $("#modalContent").innerHTML = `
      <h3>Delete account?</h3>

      <p>
        This action is permanent.
        Firebase may require you to
        log in again before deletion.
      </p>

      <div class="modal-actions">

        <button
          class="secondary"
          id="cancelDelete">
          Cancel
        </button>

        <button
          class="danger-btn"
          id="confirmDelete">
          Delete
        </button>

      </div>
    `;

    $("#modal")
      .classList
      .remove("hidden");


    $("#cancelDelete").onclick =
      closeModal;


    $("#confirmDelete").onclick =
      async () => {

        try {

          await deleteDoc(
            doc(
              db,
              "users",
              me.uid
            )
          );

          await deleteUser(auth);

          closeModal();

        } catch (e) {

          toast(
            "Please log in again, then try deleting your account."
          );
        }
      };
  };


/* =========================
   OTHER
========================= */

$("#notificationBtn").onclick =
  () =>
    toast(
      "Push notifications require Firebase Cloud Messaging setup."
    );


$("#settingsBtn").onclick =
  () =>
    toast(
      "Settings will expand as XV Chat grows."
    );


window.addEventListener(
  "beforeunload",
  () => {

    if (me) {

      updateDoc(
        doc(
          db,
          "users",
          me.uid
        ),
        {
          online: false,
          lastSeen:
            serverTimestamp()
        }
      ).catch(() => {});
    }
  }
);


/* =========================
   SERVICE WORKER
========================= */

if ("serviceWorker" in navigator) {

  navigator.serviceWorker
    .register("./sw.js")
    .catch(console.error);
}
