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

// ESTADO DO REVEAL SEQUENCIAL
let revealQueue = [];
let currentRevealIndex = 0;

// ESTADO DO CARROSSEL DE PACOTES
let currentPackIndex = 0;

// VALORES DO PASSE DE 7 DIAS
const PASS_REWARDS = [100, 150, 200, 250, 300, 400, 1000];

// FUNÇÕES DO ALERT GAMIFICADO
function showGameAlert(message, title = "OPERAÇÃO BLOQUEADA") {
  const overlay = document.getElementById("game-alert-overlay");
  const titleEl = document.getElementById("game-alert-title");
  const msgEl = document.getElementById("game-alert-message");

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
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
    if (error) showGameAlert("Erro ao autenticar com o Google: " + error.message, "ERRO DE AUTH");
  } catch (err) {
    console.error("Erro ao chamar login Google:", err);
    showGameAlert("Falha ao iniciar autenticação com o Google.", "ERRO DE AUTH");
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

  if (!profile) {
    const googleName = authUser.user_metadata?.full_name || authUser.user_metadata?.name || authUser.email;
    const { data: newProfile, error: createError } = await supabaseClient
      .from("profiles")
      .upsert([{ 
        id: authUser.id,
        youtube_handle: authUser.email, 
        display_name: googleName, 
        global_points: 1000, 
        role: "user" 
      }], { onConflict: "id" })
      .select()
      .single();

    if (createError) return showGameAlert("Erro ao criar perfil: " + createError.message, "ERRO DE PERFIL");
    profile = newProfile;
  } else if (error) {
    return showGameAlert("Erro ao consultar perfil: " + error.message, "ERRO DE PERFIL");
  }

  currentUser = profile;
  globalPoints = profile.global_points || 0;

  const userDisplay = document.getElementById("user-email-display");
  if (userDisplay) {
    userDisplay.textContent = profile.display_name;
  }

  updateUserRoleUI(profile.role);
  updatePointsDisplay();

  await loadCatalogAndInventory();
  renderAlbum();
  startPassCountdown();
  renderDailyPassUI();
}

function updateUserRoleUI(role) {
  const btnAdmin = document.getElementById("btn-admin-tab");
  if (btnAdmin) btnAdmin.style.display = (role === "admin" || role === "superadmin") ? "inline-block" : "none";

  const btnSuperadmin = document.getElementById("btn-superadmin-tab");
  if (btnSuperadmin) btnSuperadmin.style.display = (role === "superadmin") ? "inline-block" : "none";
}

function updatePointsDisplay() {
  const display = document.getElementById("points-display");
  if (display) display.textContent = `SALDO: ${globalPoints} PONTOS`;
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

// OBTÉM A DATA ATUAL EM SÃO PAULO (AAAA-MM-DD)
function getTodayDateSP() {
  const options = { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' };
  const formatter = new Intl.DateTimeFormat('en-CA', options);
  return formatter.format(new Date());
}

// GERENCIADOR DO PASSE DE BATALHA DE 7 DIAS
function renderDailyPassUI() {
  const grid = document.getElementById("pass-streak-grid");
  const btn = document.getElementById("btn-claim-pass");
  if (!grid || !currentUser) return;

  grid.replaceChildren();

  const todaySP = getTodayDateSP();
  const lastClaim = currentUser.last_claim_date;
  const currentStreak = currentUser.daily_streak || 0;

  const isClaimedToday = lastClaim === todaySP;

  // Determina qual o próximo dia da sequência
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
      nextDayToClaim = 1; // Perdeu o streak ou completou o ciclo
    }
  }

  // Renderiza os 7 cards do passe
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

  // Estado do botão principal
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

// EXECUTA O RESGATE DO PASSE VIA SUPABASE
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
        "PASSE RESGATADO!"
      );
    }
  } catch (err) {
    console.error("Erro no resgate do passe:", err);
    showGameAlert(err.message || "Não foi possível resgatar o passe no momento.", "PASSE INDISPONÍVEL");
  }
}

// TEMPORIZADOR REGRESSIVO EM TEMPO REAL PARA A MEIA-NOITE DE SP
function startPassCountdown() {
  if (countdownInterval) clearInterval(countdownInterval);

  function updateTimer() {
    const timerEl = document.getElementById("pass-countdown-timer");
    if (!timerEl) return;

    // Obtém o horário atual em São Paulo
    const nowSPStr = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
    const nowSP = new Date(nowSPStr);

    // Próxima meia-noite em São Paulo
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

// NAVEGAÇÃO ENTRE ABAS
function switchTab(tabName, event) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.remove("active"));

  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) targetTab.classList.add("active");
  if (event) event.currentTarget.classList.add("active");

  if (tabName === "album") renderAlbum();
  if (tabName === "shop") renderShop();
  if (tabName === "pass") renderDailyPassUI();
  if (tabName === "inventory") renderInventory();
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
        "RECICLAGEM CONCLUÍDA"
      );

      await loadCatalogAndInventory();
      renderInventory();
    }
  } catch (err) {
    console.error("Erro na reciclagem:", err);
    showGameAlert(err.message || "Falha ao processar a venda de repetidas.", "ERRO NA OPERAÇÃO");
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
    return showGameAlert("Pontos insuficientes para adquirir este pacote!", "SALDO INSUFICIENTE");
  }

  try {
    const { data: drawnItems, error } = await supabaseClient.rpc("open_pack", {
      pack_id_param: pack.id
    });

    if (error) {
      return showGameAlert(error.message, "FALHA NA COMPRA");
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
    showGameAlert("Erro ao conectar com o servidor: " + err.message, "ERRO DE CONEXÃO");
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
    return showGameAlert("Acesso negado: apenas o Superadmin pode cadastrar figurinhas.", "ACESSO NEGADO");
  }

  const id = document.getElementById("sticker-id").value.trim();
  const title = document.getElementById("sticker-title").value.trim();
  const imageUrl = document.getElementById("sticker-url").value.trim();
  const rarity = document.getElementById("sticker-rarity").value;

  if (!id || !title || !imageUrl) return showGameAlert("Preencha todos os campos da figurinha!", "CAMPOS INCOMPLETOS");

  const { error } = await supabaseClient.from("stickers").insert([{
    id: id,
    title: title,
    image_url: imageUrl,
    rarity: rarity,
    channel_id: "00000000-0000-0000-0000-000000000000"
  }]);

  if (error) return showGameAlert("Erro ao cadastrar figurinha: " + error.message, "ERRO AO CADASTRAR");

  showGameAlert("Figurinha cadastrada com sucesso!", "SUCESSO");
  await loadCatalogAndInventory();
  renderAlbum();
}
