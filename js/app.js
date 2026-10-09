// CONFIGURAÇÃO DO CLIENTE SUPABASE
const SUPABASE_URL = "https://bysyjbuqdeayxoryrjmj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_FCdyKbtrv_-59kkIcd9xRg_gtFXE4ny";

// ÁUDIOS E EFEITOS SONOROS (SUPABASE STORAGE)
const AUDIO_BUY_URL = 'https://bysyjbuqdeayxoryrjmj.supabase.co/storage/v1/object/public/figurinhas/compra.mp3';
const AUDIO_LOOT_URL = 'https://bysyjbuqdeayxoryrjmj.supabase.co/storage/v1/object/public/figurinhas/loot.mp3';

// Instâncias Globais dos Áudios com Pré-carregamento ativado
const buySound = new Audio(AUDIO_BUY_URL);
buySound.preload = 'auto';

const lootSound = new Audio(AUDIO_LOOT_URL);
lootSound.preload = 'auto';

// Função auxiliar com tratamento de erros para reprodução do áudio
function playAudio(sound) {
  sound.currentTime = 0;
  const playPromise = sound.play();
  if (playPromise !== undefined) {
    playPromise.catch(error => {
      console.warn("Autoplay bloqueado pelo navegador ou erro ao carregar áudio:", error);
    });
  }
}

// Desbloqueia as permissões de som do navegador na primeira interação
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

// ESTADO DO REVEAL SEQUENCIAL (CARD POR CARD)
let revealQueue = [];
let currentRevealIndex = 0;

// ESTADO DO CARROSSEL DE PACOTES
let currentPackIndex = 0;

// INICIALIZAÇÃO E ESCUTA DE AUTENTICAÇÃO
document.addEventListener("DOMContentLoaded", async () => {
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
});

// OCULTA / EXIBE TELA DE LOGIN
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

// LOGIN GOOGLE
async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin + window.location.pathname
    }
  });
  if (error) alert("Erro ao autenticar com o Google: " + error.message);
}

// LOGOUT
async function handleLogout() {
  await supabaseClient.auth.signOut();
  window.location.reload();
}

// INICIALIZA USUÁRIO AUTENTICADO
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

    if (createError) return alert("Erro ao criar perfil: " + createError.message);
    profile = newProfile;
  } else if (error) {
    return alert("Erro ao consultar perfil: " + error.message);
  }

  currentUser = profile;
  globalPoints = profile.global_points;

  const userDisplay = document.getElementById("user-email-display");
  if (userDisplay) {
    userDisplay.textContent = profile.display_name;
  }

  updateUserRoleUI(profile.role);
  updatePointsDisplay();

  await loadCatalogAndInventory();
  renderAlbum();
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

// CARREGA CATÁLOGO E INVENTÁRIO
async function loadCatalogAndInventory() {
  const { data: stickers } = await supabaseClient.from("stickers").select("*").eq("is_active", true);
  allStickers = stickers || [];

  const { data: packs } = await supabaseClient.from("packs").select("*").eq("is_active", true);
  availablePacks = packs || [];

  if (currentUser) {
    const { data: profile } = await supabaseClient
      .from("profiles")
      .select("global_points")
      .eq("id", currentUser.id)
      .single();

    if (profile) {
      globalPoints = profile.global_points;
      currentUser.global_points = profile.global_points;
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

// NAVEGAÇÃO ENTRE ABAS
function switchTab(tabName, event) {
  document.querySelectorAll(".tab-content").forEach(el => el.classList.remove("active"));
  document.querySelectorAll(".nav-btn").forEach(el => el.classList.remove("active"));

  const targetTab = document.getElementById(`tab-${tabName}`);
  if (targetTab) targetTab.classList.add("active");
  if (event) event.currentTarget.classList.add("active");

  if (tabName === "album") renderAlbum();
  if (tabName === "shop") renderShop();
  if (tabName === "inventory") renderInventory();
}

// RENDERIZAR MEU ÁLBUM (SEM INNERHTML INSEGURO)
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

// RENDERIZAR INVENTÁRIO (REPETIDAS)
function renderInventory() {
  const grid = document.getElementById("inventory-grid");
  const status = document.getElementById("inventory-status");
  if (!grid) return;

  grid.replaceChildren();
  let totalPossuidas = 0;

  allStickers.forEach(sticker => {
    const count = userInventory[sticker.id] || 0;
    if (count > 0) {
      totalPossuidas += count;

      const card = document.createElement("div");
      card.className = `card rarity-${encodeURIComponent(sticker.rarity)}`;
      card.onclick = () => openInspect(sticker);

      if (count > 1) {
        const badge = document.createElement("div");
        badge.className = "badge";
        badge.textContent = `+${count - 1} Repetida(s)`;
        card.appendChild(badge);
      }

      const img = document.createElement("img");
      img.src = sticker.image_url;
      img.alt = sticker.title;

      const titleDiv = document.createElement("div");
      titleDiv.className = "card-title";
      titleDiv.textContent = `#${sticker.id} (x${count})`;

      card.appendChild(img);
      card.appendChild(titleDiv);
      grid.appendChild(card);
    }
  });

  if (status) {
    status.textContent = totalPossuidas === 0 
      ? "Sua coleção está vazia. Abra pacotes na loja!" 
      : `Total de figurinhas no seu inventário: ${totalPossuidas}`;
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

// CARROSSEL - NAVEGAÇÃO
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

// UNBOXING SEGURO VIA RPC SUPABASE
async function startUnboxingCeremony(pack) {
  if (globalPoints < pack.cost_points) {
    return alert("Pontos insuficientes para comprar este pacote!");
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

  try {
    // Executa o sorteio e debito de pontos com seguranca no PostgreSQL
    const { data: drawnItems, error } = await supabaseClient.rpc("open_pack", {
      pack_id_param: pack.id
    });

    if (error) throw error;

    await loadCatalogAndInventory();

    setTimeout(() => {
      playAudio(lootSound);
      ceremonyOverlay.classList.remove("active");
      startSequentialReveal(drawnItems);
    }, 2800);

  } catch (err) {
    ceremonyOverlay.classList.remove("active");
    alert("Erro na abertura do pacote: " + err.message);
  }
}

// REVELAÇÃO SEQUENCIAL DAS FIGURINHAS
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

// INSPEÇÃO DE FIGURINHAS
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

// CADASTRO SUPERADMIN
async function createStickerBySuperadmin() {
  if (!currentUser || currentUser.role !== "superadmin") {
    return alert("Acesso negado: apenas o Superadmin pode cadastrar figurinhas.");
  }

  const id = document.getElementById("sticker-id").value.trim();
  const title = document.getElementById("sticker-title").value.trim();
  const imageUrl = document.getElementById("sticker-url").value.trim();
  const rarity = document.getElementById("sticker-rarity").value;

  if (!id || !title || !imageUrl) return alert("Preencha todos os campos da figurinha!");

  const { error } = await supabaseClient.from("stickers").insert([{
    id: id,
    title: title,
    image_url: imageUrl,
    rarity: rarity,
    channel_id: "00000000-0000-0000-0000-000000000000"
  }]);

  if (error) return alert("Erro ao cadastrar figurinha: " + error.message);

  alert("Figurinha cadastrada com sucesso!");
  await loadCatalogAndInventory();
  renderAlbum();
}
