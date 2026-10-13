// CONFIGURAÇÃO DO CLIENTE SUPABASE
const SUPABASE_URL = "https://bysyjbuqdeayxoryrjmj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_FCdyKbtrv_-59kkIcd9xRg_gtFXE4ny";

// ÁUDIOS E EFEITOS SONOROS (SUPABASE STORAGE)
const AUDIO_BUY_URL = 'https://bysyjbuqdeayxoryrjmj.supabase.co/storage/v1/object/public/figurinhas/compra.mp3';
const AUDIO_LOOT_URL = 'https://bysyjbuqdeayxoryrjmj.supabase.co/storage/v1/object/public/figurinhas/loot.mp3';

// Instâncias Globais dos Áudios
const buySound = new Audio(AUDIO_BUY_URL);
buySound.preload = 'auto';

const lootSound = new Audio(AUDIO_LOOT_URL);
lootSound.preload = 'auto';

function playAudio(sound) {
  sound.currentTime = 0;
  const playPromise = sound.play();
  if (playPromise !== undefined) {
    playPromise.catch(error => {
      console.warn("Autoplay bloqueado pelo navegador ou erro ao carregar áudio:", error);
    });
  }
}

document.addEventListener('click', () => {
  buySound.load();
  lootSound.load();
}, { once: true });

// Instância do cliente Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ESTADO GLOBAL DA APLICAÇÃO
let currentUser = null;
let globalPoints = 0;
let userInventory = {};
let allStickers = [];
let availablePacks = [];
let countdownInterval = null;

// ESTADO DE TROCAS E INSPEÇÃO DO AMIGO
let selectedFriendForTrade = null;
let selectedTargetStickerForTrade = null;

// ESTADO DO REVEAL SEQUENCIAL
let revealQueue = [];
let currentRevealIndex = 0;

// ESTADO DO CARROSSEL DE PACOTES
let currentPackIndex = 0;

// VALORES DO PASSE DE 7 DIAS
const PASS_REWARDS = [100, 150, 200, 250, 300, 400, 1000];

// FUNÇÕES DO ALERT GAMIFICADO
function showGameAlert(message, title = "Aviso do Sistema", icon = "ℹ️") {
  const overlay = document.getElementById("game-alert-overlay");
  const titleEl = document.getElementById("game-alert-title");
  const msgEl = document.getElementById("game-alert-message");
  const iconEl = overlay?.querySelector(".alert-defeat-icon");

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (iconEl) iconEl.textContent = icon;
  if (overlay) overlay.classList.add("active");
}

function closeGameAlert() {
  document.getElementById("game-alert-overlay")?.classList.remove("active");
}

// INICIALIZAÇÃO E ESCUTA DE AUTENTICAÇÃO
document.addEventListener("DOMContentLoaded", async () => {
  try {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      if (session && session.user) {
        hideLoginScreen();
        await initAuthenticatedUser(session.user);
      } else {
        showLoginScreen();
      }
    });

    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session && session.user) {
      hideLoginScreen();
      await initAuthenticatedUser(session.user);
    } else {
      showLoginScreen();
    }
  } catch (err) {
    console.error("Erro na inicialização da sessão:", err);
    showLoginScreen();
  }

  // ATALHO PARA BUSCA DE AMIGOS COM A TECLA ENTER
  const friendSearchInput = document.getElementById("friend-search-input");
  if (friendSearchInput) {
    friendSearchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        handleSearchFriend();
      }
    });
  }

  // BUSCA EM TEMPO REAL NAS REPETIDAS DO AMIGO (NOME OU #ID)
  const dupSearchInput = document.getElementById("friend-dup-search-input");
  if (dupSearchInput) {
    dupSearchInput.addEventListener("input", () => {
      if (selectedFriendForTrade) {
        loadFriendDuplicatesList(selectedFriendForTrade.id, dupSearchInput.value.trim());
      }
    });
  }
});

function hideLoginScreen() {
  const loginOverlay = document.getElementById("login-screen");
  if (loginOverlay) loginOverlay.style.display = "none";

  const mainApp = document.getElementById("main-app");
  if (mainApp) mainApp.style.display = "block";
}

function showLoginScreen() {
  const loginOverlay = document.getElementById("login-screen");
  if (loginOverlay) loginOverlay.style.display = "flex";

  const mainApp = document.getElementById("main-app");
  if (mainApp) mainApp.style.display = "none";
}

async function loginWithGoogle() {
  try {
    const { error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + window.location.pathname
      }
    });
    if (error) showGameAlert("Erro ao autenticar com o Google: " + error.message, "Erro de Autenticação", "⚠️");
  } catch (err) {
    console.error("Erro ao chamar login Google:", err);
    showGameAlert("Falha ao iniciar autenticação com o Google.", "Erro de Autenticação", "⚠️");
  }
}

async function handleLogout() {
  await supabaseClient.auth.signOut();
  window.location.reload();
}

async function initAuthenticatedUser(authUser) {
  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .maybeSingle();

  const googleAvatar = authUser.user_metadata?.avatar_url || authUser.user_metadata?.picture || null;
  const googleEmail = authUser.email || null;
  const googleName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email;
  
  const preferredHandle = authUser.user_metadata?.preferred_username || null;
  const validHandle = (preferredHandle && !preferredHandle.includes("@")) ? preferredHandle : null;

  if (!profile) {
    const { data: newProfile, error: createError } = await supabaseClient
      .from("profiles")
      .upsert([{ 
        id: authUser.id,
        youtube_handle: validHandle, 
        display_name: googleName, 
        email: googleEmail,
        avatar_url: googleAvatar,
        global_points: 1000, 
        role: "user" 
      }], { onConflict: "id" })
      .select()
      .single();

    if (createError) return showGameAlert("Erro ao criar perfil: " + createError.message, "Erro de Perfil", "⚠️");
    profile = newProfile;
  } else if (error) {
    return showGameAlert("Erro ao consultar perfil: " + error.message, "Erro de Perfil", "⚠️");
  } else {
    if (profile.avatar_url !== googleAvatar || profile.email !== googleEmail) {
      const { data: updatedProfile } = await supabaseClient
        .from("profiles")
        .update({ 
          avatar_url: googleAvatar,
          email: googleEmail
        })
        .eq("id", authUser.id)
        .select()
        .single();

      if (updatedProfile) profile = updatedProfile;
    }
  }

  currentUser = profile;
  globalPoints = profile.global_points || 0;

  updateUserRoleUI(profile.role);
  updateProfileUI(profile);
  updatePointsDisplay();

  await loadCatalogAndInventory();
  renderAlbum();
  startPassCountdown();
  renderDailyPassUI();
  await loadFriendsAndRequests();
}

function updateUserRoleUI(role) {
  const adminHeader = document.getElementById("admin-header-bar");
  if (adminHeader) {
    adminHeader.style.display = (role === "admin" || role === "superadmin") ? "flex" : "none";
  }

  const btnAdmin = document.getElementById("btn-admin-tab");
  if (btnAdmin) btnAdmin.style.display = (role === "admin" || role === "superadmin") ? "inline-block" : "none";

  const btnSuperadmin = document.getElementById("btn-superadmin-tab");
  if (btnSuperadmin) btnSuperadmin.style.display = (role === "superadmin") ? "inline-block" : "none";
}

function updateProfileUI(profile) {
  if (!profile) return;

  const userDisplay = document.getElementById("user-email-display");
  if (userDisplay) {
    userDisplay.textContent = profile.display_name || "Usuário";
  }

  const nameEl = document.getElementById("profile-display-name");
  if (nameEl) nameEl.textContent = profile.display_name || "Usuário Anônimo";

  const tagEl = document.getElementById("profile-tag");
  if (tagEl) tagEl.textContent = profile.tag ? `#${profile.tag}` : "#0000";

  const emailEl = document.getElementById("profile-email");
  if (emailEl) emailEl.textContent = profile.email ? `🔒 ${profile.email}` : "🔒 E-mail não informado";

  const handleEl = document.getElementById("profile-handle");
  if (handleEl) {
    const isInvalidHandle = !profile.youtube_handle || 
                            profile.youtube_handle.includes("@") || 
                            profile.youtube_handle === profile.email;

    if (!isInvalidHandle) {
      handleEl.textContent = `@${profile.youtube_handle}`;
      handleEl.style.display = "block";
    } else {
      handleEl.style.display = "none";
    }
  }

  const avatarEl = document.getElementById("profile-avatar-img");
  if (avatarEl) {
    avatarEl.src = profile.avatar_url || "https://via.placeholder.com/100?text=USER";
  }
}

function updatePointsDisplay() {
  const display = document.getElementById("points-display");
  if (display) display.textContent = `SALDO: ${globalPoints} PONTOS`;

  const profilePoints = document.getElementById("profile-points-balance");
  if (profilePoints) profilePoints.textContent = `${globalPoints} PTS`;
}

async function loadCatalogAndInventory() {
  const { data: stickers } = await supabaseClient.from("stickers").select("*").eq("is_active", true);
  allStickers = stickers || [];

  const { data: packs } = await supabaseClient.from("packs").select("*").eq("is_active", true);
  availablePacks = packs || [];

  if (currentUser) {
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("*")
      .eq("id", currentUser.id)
      .single();

    if (profile) {
      globalPoints = profile.global_points || 0;
      currentUser = profile;
      updatePointsDisplay();
      updateProfileUI(profile);
    }

    const { data: inventory } = await supabaseClient
      .from("user_stickers")
      .select("*")
      .eq("user_id", currentUser.id);

    userInventory = {};
    if (inventory) {
      inventory.forEach(item => {
        if (item.quantity > 0) {
          userInventory[item.sticker_id] = item.quantity;
        }
      });
    }
  }
}

function getTodayDateSP() {
  const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  return formatter.format(new Date());
}

function renderDailyPassUI() {
  const grid = document.getElementById("pass-streak-grid");
  const btn = document.getElementById("btn-claim-pass");
  if (!grid || !currentUser) return;

  grid.replaceChildren();

  const todaySP = getTodayDateSP();
  const lastClaim = currentUser.last_claim_date;
  const currentStreak = currentUser.daily_streak || 0;

  const isClaimedToday = lastClaim === todaySP;

  let nextDayToClaim = 1;
  if (lastClaim) {
    const lastDateObj = new Date(lastClaim);
    const todayObj = new Date(todaySP);
    const diffDays = Math.round((todayObj - lastDateObj) / (1000 * 60 * 60 * 24));

    if (isClaimedToday) {
      nextDayToClaim = currentStreak;
    } else if (diffDays === 1 && currentStreak < 7) {
      nextDayToClaim = currentStreak + 1;
    } else {
      nextDayToClaim = 1;
    }
  }

  PASS_REWARDS.forEach((reward, index) => {
    const dayNumber = index + 1;
    const card = document.createElement("div");

    let cardStateClass = "locked";
    let tagText = "LOCKED";
    let tagClass = "locked";

    if (dayNumber < nextDayToClaim || (dayNumber === nextDayToClaim && isClaimedToday)) {
      cardStateClass = "claimed";
      tagText = "RESGATADO ✔️";
      tagClass = "claimed";
    } else if (dayNumber === nextDayToClaim && !isClaimedToday) {
      cardStateClass = "active-day";
      tagText = "DISPONÍVEL 🎁";
      tagClass = "active";
    }

    card.className = `pass-card ${cardStateClass}`;

    const title = document.createElement("div");
    title.className = "pass-day-title";
    title.textContent = `DIA ${dayNumber}`;

    const icon = document.createElement("div");
    icon.className = "pass-reward-icon";
    icon.textContent = dayNumber === 7 ? "🏆" : "🎁";

    const points = document.createElement("div");
    points.className = "pass-points-text";
    points.textContent = `+${reward} PTS`;

    const tag = document.createElement("div");
    tag.className = `pass-status-tag ${tagClass}`;
    tag.textContent = tagText;

    card.appendChild(title);
    card.appendChild(icon);
    card.appendChild(points);
    card.appendChild(tag);
    grid.appendChild(card);
  });

  if (btn) {
    if (isClaimedToday) {
      btn.disabled = true;
      btn.textContent = "✅ RECOMPENSA DE HOJE JÁ RESGATADA";
    } else {
      btn.disabled = false;
      const amount = PASS_REWARDS[nextDayToClaim - 1];
      btn.textContent = `🎁 RESGATAR DIA ${nextDayToClaim} (+${amount} PONTOS)`;
    }
  }
}

async function handleClaimDailyPass() {
  try {
    const { data, error } = await supabaseClient.rpc("claim_daily_pass");

    if (error) throw error;

    if (data && data.success) {
      globalPoints = data.new_balance;
      if (currentUser) {
        currentUser.global_points = data.new_balance;
        currentUser.daily_streak = data.current_streak;
        currentUser.last_claim_date = data.claim_date;
      }

      updatePointsDisplay();
      renderDailyPassUI();

      if (window.confetti) {
        confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
      }

      showGameAlert(
        `Você resgatou o Dia ${data.current_streak} e recebeu +${data.earned_points} PONTOS!`,
        "Passe Resgatado!",
        "🎁"
      );
    }
  } catch (err) {
    console.error("Erro no resgate do passe:", err);
    showGameAlert(err.message || "Não foi possível resgatar o passe no momento.", "Passe Indisponível", "⚠️");
  }
}

function startPassCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  function updateTimer() {
    const timerEl = document.getElementById("pass-countdown-timer");
    if (!timerEl) return;

    const nowSPStr = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
    const nowSP = new Date(nowSPStr);

    const nextResetSP = new Date(nowSP);
    nextResetSP.setHours(24, 0, 0, 0);

    const diff = nextResetSP - nowSP;

    if (diff <= 0) {
      timerEl.textContent = "00:00:00 (RESETANDO...)";
      loadCatalogAndInventory().then(() => renderDailyPassUI());
      return;
    }

    const hours = String(Math.floor(diff / (1000 * 60 * 60))).padStart(2, '0');
    const minutes = String(Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))).padStart(2, '0');
    const seconds = String(Math.floor((diff % (1000 * 60)) / 1000)).padStart(2, '0');

    timerEl.textContent = `${hours}:${minutes}:${seconds}`;
  }

  updateTimer();
  countdownInterval = setInterval(updateTimer, 1000);
}

function switchTab(tabName, event) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.remove("active"));

  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) targetTab.classList.add("active");
  if (event) event.currentTarget.classList.add("active");

  if (tabName === "album") renderAlbum();
  if (tabName === "shop") renderShop();
  if (tabName === "perfil") {
    renderDailyPassUI();
    if (currentUser) updateProfileUI(currentUser);
    loadFriendsAndRequests();
  }
  if (tabName === "inventory") renderInventory();
}

// ==============================================================================
// FASE 3: MÓDULO DE AMIGOS & CONSULTA DE REPETIDAS (COM BUSCA POR NOME OU #ID)
// ==============================================================================

async function handleSearchFriend() {
  const inputEl = document.getElementById("friend-search-input");
  const resultsContainer = document.getElementById("friends-search-results");
  if (!inputEl || !resultsContainer) return;

  const query = inputEl.value.trim();
  if (!query) return;

  resultsContainer.replaceChildren();

  const loadingP = document.createElement("p");
  loadingP.className = "status-text";
  loadingP.textContent = "Buscando usuários...";
  resultsContainer.appendChild(loadingP);

  try {
    const { data: users, error } = await supabaseClient.rpc("search_user_for_friendship", {
      p_search_query: query
    });

    if (error) throw error;

    resultsContainer.replaceChildren();

    if (!users || users.length === 0) {
      const emptyP = document.createElement("p");
      emptyP.className = "status-text";
      emptyP.textContent = "Nenhum usuário encontrado com esse termo.";
      resultsContainer.appendChild(emptyP);
      return;
    }

    const userIds = users.map(u => u.id);
    const { data: existingRelationships } = await supabaseClient
      .from("friendships")
      .select("user_id, friend_id, status")
      .or(`and(user_id.eq.${currentUser.id},friend_id.in.(${userIds.join(",")})),and(friend_id.eq.${currentUser.id},user_id.in.(${userIds.join(",")}))`);

    const friendshipMap = {};
    if (existingRelationships) {
      existingRelationships.forEach(rel => {
        const otherId = rel.user_id === currentUser.id ? rel.friend_id : rel.user_id;
        friendshipMap[otherId] = rel.status;
      });
    }

    users.forEach(u => {
      const card = document.createElement("div");
      card.className = "friend-user-card";

      const infoBox = document.createElement("div");
      infoBox.className = "friend-user-info";

      const avatar = document.createElement("img");
      avatar.className = "friend-avatar-img";
      avatar.src = u.avatar_url || "https://via.placeholder.com/100?text=USER";

      const details = document.createElement("div");
      details.className = "friend-details";

      const nameRow = document.createElement("div");
      nameRow.className = "friend-name-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "friend-display-name";
      nameSpan.textContent = u.display_name || "Usuário";

      const tagSpan = document.createElement("span");
      tagSpan.className = "friend-tag-badge";
      tagSpan.textContent = u.tag ? `#${u.tag}` : "#0000";

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(tagSpan);
      details.appendChild(nameRow);
      infoBox.appendChild(avatar);
      infoBox.appendChild(details);

      const actionBox = document.createElement("div");
      actionBox.className = "friend-action-btns";

      const status = friendshipMap[u.id];
      const btnAdd = document.createElement("button");
      btnAdd.id = `btn-friend-action-${u.id}`;

      if (status === "accepted") {
        btnAdd.className = "btn-friend-action btn-friend-disabled";
        btnAdd.textContent = "🤝 AMIGOS";
        btnAdd.disabled = true;
      } else if (status === "pending") {
        btnAdd.className = "btn-friend-action btn-friend-pending";
        btnAdd.textContent = "⏳ PENDENTE";
        btnAdd.disabled = true;
      } else {
        btnAdd.className = "btn-friend-action btn-friend-accept";
        btnAdd.textContent = "➕ ADICIONAR";
        btnAdd.onclick = () => sendFriendRequestInline(u.id);
      }

      actionBox.appendChild(btnAdd);
      card.appendChild(infoBox);
      card.appendChild(actionBox);
      resultsContainer.appendChild(card);
    });

  } catch (err) {
    console.error("Erro ao buscar usuários:", err);
    resultsContainer.replaceChildren();
    showGameAlert(err.message || "Erro ao realizar busca.", "Erro de Busca", "⚠️");
  }
}

async function sendFriendRequestInline(targetUserId) {
  const btn = document.getElementById(`btn-friend-action-${targetUserId}`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = "ENVIANDO...";
  }

  try {
    const { data, error } = await supabaseClient.rpc("send_friend_request", {
      p_target_user_id: targetUserId
    });

    if (error) throw error;

    if (data) {
      if (data.success || data.message?.includes("já existe")) {
        if (btn) {
          btn.className = "btn-friend-action btn-friend-pending";
          btn.textContent = "⏳ PENDENTE";
          btn.disabled = true;
        }
        await loadFriendsAndRequests();
      } else {
        if (btn) {
          btn.disabled = false;
          btn.textContent = "➕ ADICIONAR";
        }
        showGameAlert(data.message, "Aviso", "ℹ️");
      }
    }
  } catch (err) {
    console.error("Erro ao enviar solicitação:", err);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "➕ ADICIONAR";
    }
    showGameAlert(err.message || "Falha ao enviar convite.", "Erro de Conexão", "⚠️");
  }
}

async function loadFriendsAndRequests() {
  if (!currentUser) return;

  const requestsSection = document.getElementById("friends-requests-section");
  const requestsList = document.getElementById("friends-requests-list");
  const activeList = document.getElementById("friends-active-list");

  if (!activeList) return;

  try {
    const { data: pendingData, error: pendingErr } = await supabaseClient
      .from("friendships")
      .select("id, user_id, profiles!friendships_user_id_fkey(id, display_name, tag, avatar_url)")
      .eq("friend_id", currentUser.id)
      .eq("status", "pending");

    if (!pendingErr && pendingData && pendingData.length > 0) {
      if (requestsSection) requestsSection.style.display = "block";
      if (requestsList) {
        requestsList.replaceChildren();
        pendingData.forEach(item => {
          const sender = item.profiles;
          if (!sender) return;

          const card = document.createElement("div");
          card.className = "friend-user-card";

          const infoBox = document.createElement("div");
          infoBox.className = "friend-user-info";

          const avatar = document.createElement("img");
          avatar.className = "friend-avatar-img";
          avatar.src = sender.avatar_url || "https://via.placeholder.com/100?text=USER";

          const details = document.createElement("div");
          details.className = "friend-details";

          const nameRow = document.createElement("div");
          nameRow.className = "friend-name-row";

          const nameSpan = document.createElement("span");
          nameSpan.className = "friend-display-name";
          nameSpan.textContent = sender.display_name;

          const tagSpan = document.createElement("span");
          tagSpan.className = "friend-tag-badge";
          tagSpan.textContent = `#${sender.tag}`;

          nameRow.appendChild(nameSpan);
          nameRow.appendChild(tagSpan);
          details.appendChild(nameRow);
          infoBox.appendChild(avatar);
          infoBox.appendChild(details);

          const actionBox = document.createElement("div");
          actionBox.className = "friend-action-btns";

          const btnAccept = document.createElement("button");
          btnAccept.className = "btn-friend-action btn-friend-accept";
          btnAccept.textContent = "✔ ACEITAR";
          btnAccept.onclick = () => respondFriendRequest(item.id, 'accepted');

          const btnReject = document.createElement("button");
          btnReject.className = "btn-friend-action btn-friend-reject";
          btnReject.textContent = "✖ RECUSAR";
          btnReject.onclick = () => respondFriendRequest(item.id, 'rejected');

          actionBox.appendChild(btnAccept);
          actionBox.appendChild(btnReject);
          card.appendChild(infoBox);
          card.appendChild(actionBox);
          requestsList.appendChild(card);
        });
      }
    } else {
      if (requestsSection) requestsSection.style.display = "none";
    }

    const { data: friendsData, error: friendsErr } = await supabaseClient
      .from("friendships")
      .select("id, user_id, friend_id, status")
      .or(`user_id.eq.${currentUser.id},friend_id.eq.${currentUser.id}`)
      .eq("status", "accepted");

    activeList.replaceChildren();

    if (friendsErr || !friendsData || friendsData.length === 0) {
      const emptyP = document.createElement("p");
      emptyP.className = "status-text";
      emptyP.textContent = "Você ainda não possui amigos adicionados.";
      activeList.appendChild(emptyP);
      return;
    }

    const friendUserIds = friendsData.map(f => f.user_id === currentUser.id ? f.friend_id : f.user_id);

    const { data: friendProfiles } = await supabaseClient
      .from("profiles")
      .select("id, display_name, tag, avatar_url")
      .in("id", friendUserIds);

    if (!friendProfiles || friendProfiles.length === 0) {
      const emptyP = document.createElement("p");
      emptyP.className = "status-text";
      emptyP.textContent = "Nenhum amigo ativo encontrado.";
      activeList.appendChild(emptyP);
      return;
    }

    friendProfiles.forEach(f => {
      const card = document.createElement("div");
      card.className = "friend-user-card";

      const infoBox = document.createElement("div");
      infoBox.className = "friend-user-info";

      const avatar = document.createElement("img");
      avatar.className = "friend-avatar-img";
      avatar.src = f.avatar_url || "https://via.placeholder.com/100?text=USER";

      const details = document.createElement("div");
      details.className = "friend-details";

      const nameRow = document.createElement("div");
      nameRow.className = "friend-name-row";

      const nameSpan = document.createElement("span");
      nameSpan.className = "friend-display-name";
      nameSpan.textContent = f.display_name;

      const tagSpan = document.createElement("span");
      tagSpan.className = "friend-tag-badge";
      tagSpan.textContent = `#${f.tag}`;

      nameRow.appendChild(nameSpan);
      nameRow.appendChild(tagSpan);
      details.appendChild(nameRow);
      infoBox.appendChild(avatar);
      infoBox.appendChild(details);

      const actionBox = document.createElement("div");
      actionBox.className = "friend-action-btns";

      // BOTÃO NOVO PARA EXAMINAR AS REPETIDAS DO AMIGO
      const btnViewDuplicates = document.createElement("button");
      btnViewDuplicates.className = "btn-friend-action btn-friend-accept";
      btnViewDuplicates.textContent = "📦 VER REPETIDAS";
      btnViewDuplicates.onclick = () => openFriendDuplicatesModal(f);

      actionBox.appendChild(btnViewDuplicates);
      card.appendChild(infoBox);
      card.appendChild(actionBox);
      activeList.appendChild(card);
    });

  } catch (err) {
    console.error("Erro ao carregar amizades:", err);
  }
}

async function respondFriendRequest(friendshipId, newStatus) {
  try {
    const { error } = await supabaseClient
      .from("friendships")
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq("id", friendshipId);

    if (error) throw error;

    await loadFriendsAndRequests();
  } catch (err) {
    console.error("Erro ao responder solicitação:", err);
    showGameAlert(err.message || "Erro ao atualizar status.", "Erro", "⚠️");
  }
}

// ==============================================================================
// MÓDULO DE INSPEÇÃO DE REPETIDAS & PROPOSTA DE TROCA ASSÍNCRONA
// ==============================================================================

async function openFriendDuplicatesModal(friend) {
  selectedFriendForTrade = friend;
  const overlay = document.getElementById("friend-duplicates-overlay");
  const nameEl = document.getElementById("friend-dup-name");
  const searchInput = document.getElementById("friend-dup-search-input");

  if (nameEl) nameEl.textContent = friend.display_name.toUpperCase();
  if (searchInput) searchInput.value = "";

  if (overlay) overlay.classList.add("active");
  await loadFriendDuplicatesList(friend.id, "");
}

function closeFriendDuplicatesModal() {
  document.getElementById("friend-duplicates-overlay")?.classList.remove("active");
  selectedFriendForTrade = null;
}

async function loadFriendDuplicatesList(friendId, searchQuery) {
  const container = document.getElementById("friend-duplicates-grid");
  if (!container) return;

  container.replaceChildren();

  const loadingP = document.createElement("p");
  loadingP.className = "status-text";
  loadingP.textContent = "Carregando repetidas do amigo...";
  container.appendChild(loadingP);

  try {
    const { data: duplicates, error } = await supabaseClient.rpc("get_friend_duplicates", {
      p_friend_id: friendId,
      p_search_query: searchQuery
    });

    if (error) throw error;

    container.replaceChildren();

    if (!duplicates || duplicates.length === 0) {
      const emptyP = document.createElement("p");
      emptyP.className = "status-text";
      emptyP.textContent = searchQuery ? "Nenhuma figurinha encontrada para essa busca." : "Este amigo não possui figurinhas repetidas no momento.";
      container.appendChild(emptyP);
      return;
    }

    duplicates.forEach(stk => {
      const card = document.createElement("div");
      card.className = `card rarity-${encodeURIComponent(stk.rarity)}`;

      const img = document.createElement("img");
      img.src = stk.image_url;
      img.alt = stk.title;

      const titleDiv = document.createElement("div");
      titleDiv.className = "card-title";
      titleDiv.textContent = `#${stk.sticker_id} - ${stk.title}`;

      const badge = document.createElement("div");
      badge.className = "badge badge-duplicate";
      badge.textContent = `x${stk.quantity}`;

      const btnTrade = document.createElement("button");
      btnTrade.className = "nav-btn active btn-recycle";
      btnTrade.style.marginTop = "8px";
      btnTrade.textContent = "🔄 PROPOR TROCA";
      btnTrade.onclick = (e) => {
        e.stopPropagation();
        openTradeProposalModal(stk);
      };

      card.appendChild(img);
      card.appendChild(titleDiv);
      card.appendChild(badge);
      card.appendChild(btnTrade);

      container.appendChild(card);
    });

  } catch (err) {
    console.error("Erro ao carregar repetidas do amigo:", err);
    container.replaceChildren();
    showGameAlert(err.message || "Erro ao consultar inventário do amigo.", "Erro", "⚠️");
  }
}

function openTradeProposalModal(targetSticker) {
  selectedTargetStickerForTrade = targetSticker;
  const overlay = document.getElementById("trade-proposal-overlay");
  const slotContainer = document.getElementById("trade-want-card-slot");
  const selectEl = document.getElementById("trade-offer-sticker-select");

  if (!overlay || !slotContainer || !selectEl) return;

  slotContainer.replaceChildren();
  const card = document.createElement("div");
  card.className = `card rarity-${encodeURIComponent(targetSticker.rarity)}`;
  
  const img = document.createElement("img");
  img.src = targetSticker.image_url;
  img.alt = targetSticker.title;

  const titleDiv = document.createElement("div");
  titleDiv.className = "card-title";
  titleDiv.textContent = `#${targetSticker.sticker_id}`;

  card.appendChild(img);
  card.appendChild(titleDiv);
  slotContainer.appendChild(card);

  selectEl.replaceChildren();
  const userDuplicates = allStickers.filter(s => (userInventory[s.id] || 0) > 1);

  if (userDuplicates.length === 0) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "Você não tem repetidas para oferecer!";
    selectEl.appendChild(opt);
  } else {
    const defaultOpt = document.createElement("option");
    defaultOpt.value = "";
    defaultOpt.textContent = "Escolha sua figurinha repetida...";
    selectEl.appendChild(defaultOpt);

    userDuplicates.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s.id;
      opt.textContent = `#${s.id} - ${s.title} (${s.rarity.toUpperCase()})`;
      selectEl.appendChild(opt);
    });
  }

  overlay.classList.add("active");
}

function closeTradeProposalModal() {
  document.getElementById("trade-proposal-overlay")?.classList.remove("active");
  selectedTargetStickerForTrade = null;
}

async function submitTradeProposal() {
  const selectEl = document.getElementById("trade-offer-sticker-select");
  if (!selectEl || !selectedFriendForTrade || !selectedTargetStickerForTrade) return;

  const offeredStickerId = selectEl.value;
  if (!offeredStickerId) {
    return showGameAlert("Selecione uma das suas figurinhas repetidas para oferecer!", "Aviso", "⚠️");
  }

  try {
    const { data, error } = await supabaseClient.from("trades").insert([{
      sender_id: currentUser.id,
      receiver_id: selectedFriendForTrade.id,
      sender_sticker_id: offeredStickerId,
      receiver_sticker_id: selectedTargetStickerForTrade.sticker_id,
      status: "pending"
    }]).select();

    if (error) throw error;

    closeTradeProposalModal();
    closeFriendDuplicatesModal();

    showGameAlert("Proposta de troca enviada com sucesso! Seu amigo poderá aceitar ou recusar no perfil dele.", "Proposta Enviada!", "🚀");

  } catch (err) {
    console.error("Erro ao enviar proposta de troca:", err);
    showGameAlert(err.message || "Falha ao registrar a proposta de troca.", "Erro", "⚠️");
  }
}

// RENDERIZAR MEU ÁLBUM
function renderAlbum() {
  const grid = document.getElementById("album-grid");
  const status = document.getElementById("album-status");
  if (!grid) return;

  grid.replaceChildren();

  if (allStickers.length === 0) {
    if (status) status.textContent = "Nenhuma figurinha cadastrada no catálogo global.";
    return;
  }

  let coladas = 0;

  allStickers.forEach(sticker => {
    const count = userInventory[sticker.id] || 0;
    const isUnlocked = count > 0;
    if (isUnlocked) coladas++;

    const card = document.createElement("div");
    card.className = `card rarity-${encodeURIComponent(sticker.rarity)} ${isUnlocked ? '' : 'locked'}`;

    if (isUnlocked) {
      card.onclick = () => openInspect(sticker);

      if (count > 1) {
        const badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = `+${count - 1}`;
        card.appendChild(badge);
      }
    }

    const img = document.createElement("img");
    img.src = sticker.image_url;
    img.alt = isUnlocked ? sticker.title : "Bloqueado";

    const titleDiv = document.createElement("div");
    titleDiv.className = "card-title";
    titleDiv.textContent = `#${sticker.id}`;

    card.appendChild(img);
    card.appendChild(titleDiv);
    grid.appendChild(card);
  });

  if (status) status.textContent = `Figurinhas coladas: ${coladas} / ${allStickers.length}`;
}

// RENDERIZAR INVENTÁRIO COM SELETOR DE RECICLAGEM
function renderInventory() {
  const grid = document.getElementById("inventory-grid");
  const status = document.getElementById("inventory-status");
  if (!grid) return;

  grid.replaceChildren();
  let totalDuplicatedCount = 0;
  let totalPossuidas = 0;

  allStickers.forEach(sticker => {
    const count = userInventory[sticker.id] || 0;
    if (count > 0) {
      totalPossuidas += count;
      const duplicates = count - 1;

      const card = document.createElement("div");
      card.className = `card rarity-${encodeURIComponent(sticker.rarity)}`;

      const img = document.createElement("img");
      img.src = sticker.image_url;
      img.alt = sticker.title;
      img.onclick = () => openInspect(sticker);

      const titleDiv = document.createElement("div");
      titleDiv.className = "card-title";
      titleDiv.textContent = `#${sticker.id} - ${sticker.title}`;

      card.appendChild(img);
      card.appendChild(titleDiv);

      if (duplicates > 0) {
        totalDuplicatedCount += duplicates;

        const badge = document.createElement("div");
        badge.className = "badge badge-duplicate";
        badge.textContent = `x${count} (${duplicates} REPETIDA${duplicates > 1 ? 'S' : ''})`;
        card.appendChild(badge);

        const unitValue = getStickerRecycleValue(sticker.rarity);

        const recycleBox = document.createElement("div");
        recycleBox.className = "recycle-control-box";

        const label = document.createElement("label");
        label.className = "recycle-label";
        label.textContent = "VENDER REPETIDAS:";

        const inputGroup = document.createElement("div");
        inputGroup.className = "recycle-input-group";

        const input = document.createElement("input");
        input.type = "number";
        input.id = `recycle-qty-${sticker.id}`;
        input.className = "recycle-input";
        input.min = "1";
        input.max = duplicates;
        input.value = "1";
        input.onchange = () => updateRecycleValueDisplay(sticker.id, unitValue);
        input.onkeyup = () => updateRecycleValueDisplay(sticker.id, unitValue);

        const unitText = document.createElement("span");
        unitText.className = "recycle-unit-text";
        unitText.textContent = `/ ${duplicates}`;

        inputGroup.appendChild(input);
        inputGroup.appendChild(unitText);

        const totalPrice = document.createElement("div");
        totalPrice.id = `recycle-total-${sticker.id}`;
        totalPrice.className = "recycle-total-price";
        totalPrice.textContent = `+${unitValue} PONTOS`;

        const btnRecycle = document.createElement("button");
        btnRecycle.className = "nav-btn active btn-recycle";
        btnRecycle.textContent = "♻️ RECOLHER PONTOS";
        btnRecycle.onclick = (e) => {
          e.stopPropagation();
          handleRecycleSticker(sticker.id, unitValue);
        };

        recycleBox.appendChild(label);
        recycleBox.appendChild(inputGroup);
        recycleBox.appendChild(totalPrice);
        recycleBox.appendChild(btnRecycle);

        card.appendChild(recycleBox);
      }

      grid.appendChild(card);
    }
  });

  if (status) {
    if (totalPossuidas === 0) {
      status.textContent = "Sua coleção está vazia. Abra pacotes na loja!";
    } else if (totalDuplicatedCount === 0) {
      status.textContent = `Coleção com ${totalPossuidas} figurinha(s). Nenhuma repetida para vender no momento!`;
    } else {
      status.textContent = `Você possui ${totalDuplicatedCount} figurinha(s) repetida(s) disponível(is) para reciclagem.`;
    }
  }
}

function getStickerRecycleValue(rarity) {
  switch (rarity) {
    case "legendary": return 250;
    case "epic": return 120;
    case "rare": return 75;
    default: return 30;
  }
}

function updateRecycleValueDisplay(stickerId, unitValue) {
  const input = document.getElementById(`recycle-qty-${stickerId}`);
  const display = document.getElementById(`recycle-total-${stickerId}`);
  if (!input || !display) return;

  let qty = parseInt(input.value, 10) || 1;
  const max = parseInt(input.max, 10);
  if (qty < 1) qty = 1;
  if (qty > max) qty = max;
  input.value = qty;

  display.textContent = `+${qty * unitValue} PONTOS`;
}

async function handleRecycleSticker(stickerId, unitValue) {
  const input = document.getElementById(`recycle-qty-${stickerId}`);
  if (!input) return;

  const quantity = parseInt(input.value, 10);
  if (!quantity || quantity <= 0) return;

  try {
    const { data, error } = await supabaseClient.rpc("recycle_duplicates", {
      p_sticker_id: stickerId,
      p_quantity: quantity,
      p_unit_price: unitValue
    });

    if (error) throw error;

    if (data && data.success) {
      globalPoints = data.new_balance;
      if (currentUser) currentUser.global_points = data.new_balance;
      updatePointsDisplay();

      showGameAlert(
        `Você reciclou ${quantity} repetida(s) e recebeu +${data.earned_points} PONTOS!`,
        "Reciclagem Concluída",
        "♻️"
      );

      await loadCatalogAndInventory();
      renderInventory();
    }
  } catch (err) {
    console.error("Erro na reciclagem:", err);
    showGameAlert(err.message || "Falha ao processar a venda de repetidas.", "Erro na Operação", "⚠️");
  }
}

// RENDERIZAR LOJA
function renderShop() {
  updatePointsDisplay();
  const container = document.getElementById("packs-container");
  if (!container) return;

  container.replaceChildren();

  if (availablePacks.length === 0) {
    const emptyMsg = document.createElement("p");
    emptyMsg.className = "status-text";
    emptyMsg.textContent = "Nenhum pacote disponível na loja no momento.";
    container.appendChild(emptyMsg);
    return;
  }

  const carouselWrapper = document.createElement("div");
  carouselWrapper.className = "carousel-wrapper";

  const prevBtn = document.createElement("button");
  prevBtn.className = "carousel-btn prev";
  prevBtn.textContent = "❮";
  prevBtn.onclick = () => navigateCarousel(-1);

  const nextBtn = document.createElement("button");
  nextBtn.className = "carousel-btn next";
  nextBtn.textContent = "❯";
  nextBtn.onclick = () => navigateCarousel(1);

  const trackContainer = document.createElement("div");
  trackContainer.className = "carousel-track-container";

  const track = document.createElement("div");
  track.className = "carousel-track";
  track.id = "carousel-track";

  availablePacks.forEach((pack) => {
    const qty = pack.stickers_count || 1;
    const packEl = document.createElement("div");
    packEl.className = "booster-pack carousel-item";
    packEl.onclick = () => startUnboxingCeremony(pack);

    const topCrimp = document.createElement("div");
    topCrimp.className = "pack-top-crimp";

    const body = document.createElement("div");
    body.className = "pack-foil-body";

    const title = document.createElement("div");
    title.className = "pack-foil-title";
    title.textContent = pack.pack_name;

    const emblem = document.createElement("div");
    emblem.className = "pack-foil-emblem";
    emblem.textContent = "🎁";

    const sub = document.createElement("div");
    sub.className = "pack-foil-sub";
    sub.textContent = `${pack.cost_points} PONTOS`;

    const badge = document.createElement("div");
    badge.className = "pack-foil-badge";
    badge.textContent = `${qty} FIGURINHA(S)`;

    body.appendChild(title);
    body.appendChild(emblem);
    body.appendChild(sub);
    body.appendChild(badge);

    const bottomCrimp = document.createElement("div");
    bottomCrimp.className = "pack-bottom-crimp";

    packEl.appendChild(topCrimp);
    packEl.appendChild(body);
    packEl.appendChild(bottomCrimp);

    track.appendChild(packEl);
  });

  trackContainer.appendChild(track);
  carouselWrapper.appendChild(prevBtn);
  carouselWrapper.appendChild(trackContainer);
  carouselWrapper.appendChild(nextBtn);
  container.appendChild(carouselWrapper);

  const dotsContainer = document.createElement("div");
  dotsContainer.className = "carousel-dots";
  availablePacks.forEach((_, idx) => {
    const dot = document.createElement("span");
    dot.className = `carousel-dot ${idx === currentPackIndex ? 'active' : ''}`;
    dot.onclick = () => jumpToCarouselSlide(idx);
    dotsContainer.appendChild(dot);
  });
  container.appendChild(dotsContainer);

  setupSwipeEvents(trackContainer);
  updateCarouselPosition();
}

function navigateCarousel(direction) {
  if (availablePacks.length === 0) return;
  currentPackIndex = (currentPackIndex + direction + availablePacks.length) % availablePacks.length;
  updateCarouselPosition();
}

function jumpToCarouselSlide(index) {
  currentPackIndex = index;
  updateCarouselPosition();
}

function updateCarouselPosition() {
  const track = document.getElementById("carousel-track");
  if (!track) return;
  const slideWidth = 240;
  track.style.transform = `translateX(-${currentPackIndex * slideWidth}px)`;

  const dots = document.querySelectorAll(".carousel-dot");
  dots.forEach((dot, idx) => {
    if (idx === currentPackIndex) {
      dot.classList.add("active");
    } else {
      dot.classList.remove("active");
    }
  });
}

function setupSwipeEvents(element) {
  let startX = 0;
  let isDragging = false;

  element.addEventListener('touchstart', e => {
    startX = e.touches[0].clientX;
    isDragging = true;
  }, { passive: true });

  element.addEventListener('touchend', e => {
    if (!isDragging) return;
    const diffX = startX - e.changedTouches[0].clientX;
    if (Math.abs(diffX) > 40) {
      navigateCarousel(diffX > 0 ? 1 : -1);
    }
    isDragging = false;
  }, { passive: true });

  element.addEventListener('mousedown', e => {
    startX = e.clientX;
    isDragging = true;
  });

  element.addEventListener('mouseup', e => {
    if (!isDragging) return;
    const diffX = startX - e.clientX;
    if (Math.abs(diffX) > 40) {
      navigateCarousel(diffX > 0 ? 1 : -1);
    }
    isDragging = false;
  });
}

async function startUnboxingCeremony(pack) {
  if (globalPoints < pack.cost_points) {
    return showGameAlert("Pontos insuficientes para adquirir este pacote!", "Saldo Insuficiente", "⚠️");
  }

  try {
    const { data: drawnItems, error } = await supabaseClient.rpc("open_pack", {
      pack_id_param: pack.id
    });

    if (error) {
      return showGameAlert(error.message, "Falha na Compra", "⚠️");
    }

    const ceremonyOverlay = document.getElementById("loot-ceremony-overlay");
    const ceremonyPackTitle = document.getElementById("ceremony-pack-title");
    const unboxingPack = document.querySelector(".unboxing-pack");

    if (ceremonyPackTitle) ceremonyPackTitle.textContent = pack.pack_name.toUpperCase();

    unboxingPack.className = "unboxing-pack suspense-shake";
    ceremonyOverlay.classList.add("active");

    playAudio(buySound);

    setTimeout(() => {
      unboxingPack.className = "unboxing-pack tear-open";
    }, 2000);

    setTimeout(() => {
      const flashEl = document.getElementById("flash");
      if (flashEl) {
        flashEl.classList.add("active");
        setTimeout(() => flashEl.classList.remove("active"), 350);
      }
    }, 2500);

    await loadCatalogAndInventory();

    setTimeout(() => {
      playAudio(lootSound);
      ceremonyOverlay.classList.remove("active");
      startSequentialReveal(drawnItems);
    }, 2800);

  } catch (err) {
    showGameAlert("Erro ao conectar com o servidor: " + err.message, "Erro de Conexão", "⚠️");
  }
}

function startSequentialReveal(drawnItems) {
  revealQueue = drawnItems;
  currentRevealIndex = 0;
  showCurrentQueueCard();
}

function showCurrentQueueCard() {
  const overlay = document.getElementById("reveal-overlay");
  const badgeContainer = document.getElementById("loot-badge-container");
  const container = document.getElementById("revealed-card-container");
  const btnCollect = document.getElementById("btn-collect");

  if (!overlay || revealQueue.length === 0) return;

  const currentItem = revealQueue[currentRevealIndex];
  const totalItems = revealQueue.length;
  const isLast = currentRevealIndex === totalItems - 1;

  badgeContainer.replaceChildren();
  const badge = document.createElement("div");
  badge.className = `badge ${currentItem.is_new ? 'badge-new' : 'badge-duplicate'}`;
  badge.textContent = currentItem.is_new ? "★ FIGURINHA NOVA! ★" : "REPETIDA (+1)";
  badgeContainer.appendChild(badge);

  container.replaceChildren();
  const largeCard = document.createElement("div");
  largeCard.className = `large-card rarity-${encodeURIComponent(currentItem.rarity)}`;

  const img = document.createElement("img");
  img.src = currentItem.image_url;
  img.alt = currentItem.title;

  const titleDiv = document.createElement("div");
  titleDiv.className = "card-title";
  titleDiv.textContent = `#${currentItem.id} - ${currentItem.title}`;

  largeCard.appendChild(img);
  largeCard.appendChild(titleDiv);
  container.appendChild(largeCard);

  if (totalItems > 1) {
    btnCollect.textContent = isLast 
      ? `COLAR E FINALIZAR (${currentRevealIndex + 1}/${totalItems})` 
      : `PRÓXIMA FIGURINHA (${currentRevealIndex + 1}/${totalItems}) ➔`;
  } else {
    btnCollect.textContent = currentItem.is_new ? "COLAR NO ÁLBUM" : "GUARDAR NO INVENTÁRIO";
  }

  overlay.classList.add("active");

  if (window.confetti) {
    confetti({ particleCount: 120, spread: 80, origin: { y: 0.6 } });
  }
}

function closeReveal() {
  currentRevealIndex++;

  if (currentRevealIndex < revealQueue.length) {
    playAudio(lootSound);
    showCurrentQueueCard();
  } else {
    document.getElementById("reveal-overlay")?.classList.remove("active");
    revealQueue = [];
    currentRevealIndex = 0;
    renderAlbum();
  }
}

function openInspect(sticker) {
  const overlay = document.getElementById("inspect-overlay");
  const container = document.getElementById("inspect-card-container");

  if (!overlay || !container) return;

  container.replaceChildren();

  const box = document.createElement("div");
  box.className = `inspect-box rarity-${encodeURIComponent(sticker.rarity)}`;

  const img = document.createElement("img");
  img.src = sticker.image_url;
  img.alt = sticker.title;

  const titleDiv = document.createElement("div");
  titleDiv.className = "card-title";
  titleDiv.textContent = `#${sticker.id} - ${sticker.title}`;

  const rarityP = document.createElement("p");
  rarityP.className = "inspect-rarity-text";
  rarityP.textContent = `Raridade: ${sticker.rarity.toUpperCase()}`;

  box.appendChild(img);
  box.appendChild(titleDiv);
  box.appendChild(rarityP);
  container.appendChild(box);

  overlay.classList.add("active");
}

function closeInspect() {
  document.getElementById("inspect-overlay")?.classList.remove("active");
}

async function createStickerBySuperadmin() {
  if (!currentUser || currentUser.role !== "superadmin") {
    return showGameAlert("Acesso negado: apenas o Superadmin pode cadastrar figurinhas.", "Acesso Negado", "🔒");
  }

  const id = document.getElementById("sticker-id").value.trim();
  const title = document.getElementById("sticker-title").value.trim();
  const imageUrl = document.getElementById("sticker-url").value.trim();
  const rarity = document.getElementById("sticker-rarity").value;

  if (!id || !title || !imageUrl) return showGameAlert("Preencha todos os campos da figurinha!", "Campos Incompletos", "⚠️");

  const { error } = await supabaseClient.from("stickers").insert([{
    id: id,
    title: title,
    image_url: imageUrl,
    rarity: rarity,
    channel_id: "00000000-0000-0000-0000-000000000000"
  }]);

  if (error) return showGameAlert("Erro ao cadastrar figurinha: " + error.message, "Erro ao Cadastrar", "⚠️");

  showGameAlert("Figurinha cadastrada com sucesso!", "Sucesso", "✅");
  await loadCatalogAndInventory();
  renderAlbum();
}
