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

// Função auxiliar com tratamento de erros para garantir a reprodução do áudio
function playAudio(sound) {
  sound.currentTime = 0;
  const playPromise = sound.play();
  if (playPromise !== undefined) {
    playPromise.catch(error => {
      console.warn("Autoplay bloqueado pelo navegador ou erro ao carregar áudio:", error);
    });
  }
}

// Desbloqueia as permissões de som do navegador na primeira interação na página
document.addEventListener('click', () => {
  buySound.load();
  lootSound.load();
}, { once: true });

// Instância do cliente Supabase
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ESTADO GLOBAL DA APLICAÇÃO
let currentUser = null;
let globalPoints = 0;
let userInventory = {}; // Mapeamento: { 'ZE-001': quantity }
let allStickers = [];
let availablePacks = [];

// INICIALIZAÇÃO E ESCUTA DE AUTENTICAÇÃO
document.addEventListener("DOMContentLoaded", async () => {
  supabaseClient.auth.onAuthStateChange(async (event, session) => {
    if (session && session.user) {
      hideLoginScreen();
      await initAuthenticatedUser(session.user);
    }
  });

  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session && session.user) {
    hideLoginScreen();
    await initAuthenticatedUser(session.user);
  }
});

// OCULTA TELA DE LOGIN
function hideLoginScreen() {
  const loginOverlay = document.getElementById("login-screen") || document.querySelector(".auth-container");
  if (loginOverlay) loginOverlay.style.display = "none";

  const mainApp = document.getElementById("main-app");
  if (mainApp) mainApp.style.display = "block";
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
  const userEmailDisplay = document.getElementById("user-email-display");
  if (userEmailDisplay) userEmailDisplay.innerText = authUser.email;

  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error && error.code === "PGRST116") {
    const { data: newProfile, error: createError } = await supabaseClient
      .from("profiles")
      .insert([{ 
        id: authUser.id,
        youtube_handle: authUser.email, 
        display_name: authUser.user_metadata?.full_name || authUser.email, 
        global_points: 1000, 
        role: "user" 
      }])
      .select()
      .single();

    if (createError) return alert("Erro ao criar perfil: " + createError.message);
    profile = newProfile;
  } else if (error) {
    return alert("Erro ao consultar perfil: " + error.message);
  }

  currentUser = profile;
  globalPoints = profile.global_points;

  updateUserRoleUI(profile.role);
  updatePointsDisplay();

  await loadCatalogAndInventory();
  renderAlbum();
}

function updateUserRoleUI(role) {
  const roleBadge = document.getElementById("role-badge");
  if (roleBadge) {
    roleBadge.innerText = role.toUpperCase();
    roleBadge.className = `role-badge ${role}`;
  }

  const btnAdmin = document.getElementById("btn-admin-tab");
  if (btnAdmin) btnAdmin.style.display = (role === "admin" || role === "superadmin") ? "inline-block" : "none";

  const btnSuperadmin = document.getElementById("btn-superadmin-tab");
  if (btnSuperadmin) btnSuperadmin.style.display = (role === "superadmin") ? "inline-block" : "none";
}

function updatePointsDisplay() {
  const display = document.getElementById("points-display");
  if (display) display.innerText = `SALDO: ${globalPoints} PONTOS`;
}

// CARREGA CATÁLOGO E INVENTÁRIO (FILTRANDO RIGOROSAMENTE QUANTIDADE ZERO)
async function loadCatalogAndInventory() {
  const { data: stickers } = await supabaseClient.from("stickers").select("*").eq("is_active", true);
  allStickers = stickers || [];

  const { data: packs } = await supabaseClient.from("packs").select("*").eq("is_active", true);
  availablePacks = packs || [];

  if (currentUser) {
    const { data: inventory } = await supabaseClient
      .from("user_stickers")
      .select("*")
      .eq("user_id", currentUser.id);

    userInventory = {};
    if (inventory) {
      inventory.forEach(item => {
        // FILTRAGEM RIGOROSA: Apenas armazena no inventário se a quantidade for MAIOR QUE ZERO
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

// RENDERIZAR MEU ÁLBUM
function renderAlbum() {
  const grid = document.getElementById("album-grid");
  const status = document.getElementById("album-status");
  if (!grid) return;

  grid.innerHTML = "";

  if (allStickers.length === 0) {
    if (status) status.innerText = "Nenhuma figurinha cadastrada no catálogo global.";
    return;
  }

  let coladas = 0;

  allStickers.forEach(sticker => {
    const count = userInventory[sticker.id] || 0;
    // TRAVA DE SEGURANÇA: Se count <= 0 a figurinha NUNCA aparece colada
    const isUnlocked = count > 0;
    if (isUnlocked) coladas++;

    const card = document.createElement("div");
    card.className = `card rarity-${sticker.rarity} ${isUnlocked ? '' : 'locked'}`;

    if (isUnlocked) {
      card.onclick = () => openInspect(sticker);
      const duplicateBadge = count > 1 ? `<div class="badge">+${count - 1}</div>` : '';

      card.innerHTML = `
        ${duplicateBadge}
        <img src="${sticker.image_url}" alt="${sticker.title}">
        <div class="card-title">#${sticker.id}</div>
      `;
    } else {
      card.innerHTML = `
        <img src="${sticker.image_url}" alt="Bloqueado" style="filter: brightness(0) opacity(0.15);">
        <div class="card-title">#${sticker.id}</div>
      `;
    }

    grid.appendChild(card);
  });

  if (status) status.innerText = `Figurinhas coladas: ${coladas} / ${allStickers.length}`;
}

// RENDERIZAR INVENTÁRIO (REPETIDAS)
function renderInventory() {
  const grid = document.getElementById("inventory-grid");
  const status = document.getElementById("inventory-status");
  if (!grid) return;

  grid.innerHTML = "";
  let totalPossuidas = 0;

  allStickers.forEach(sticker => {
    const count = userInventory[sticker.id] || 0;
    if (count > 0) {
      totalPossuidas += count;

      const card = document.createElement("div");
      card.className = `card rarity-${sticker.rarity}`;
      card.onclick = () => openInspect(sticker);

      card.innerHTML = `
        ${count > 1 ? `<div class="badge">+${count - 1} Repetida(s)</div>` : ''}
        <img src="${sticker.image_url}" alt="${sticker.title}">
        <div class="card-title">#${sticker.id} (x${count})</div>
      `;
      grid.appendChild(card);
    }
  });

  if (status) {
    status.innerText = totalPossuidas === 0 
      ? "Sua coleção está vazia. Abra pacotes na loja!" 
      : `Total de figurinhas no seu inventário: ${totalPossuidas}`;
  }
}

// RENDERIZAR LOJA
function renderShop() {
  updatePointsDisplay();
  const container = document.getElementById("packs-container");
  if (!container) return;

  container.innerHTML = "";

  if (availablePacks.length === 0) {
    container.innerHTML = "<p style='color: #aaa;'>Nenhum pacote disponível na loja no momento.</p>";
    return;
  }

  availablePacks.forEach(pack => {
    const packEl = document.createElement("div");
    packEl.className = "booster-pack";
    packEl.onclick = () => startUnboxingCeremony(pack);

    packEl.innerHTML = `
      <div class="pack-top-crimp"></div>
      <div class="pack-foil-body">
        <div class="pack-foil-title">${pack.pack_name}</div>
        <div class="pack-foil-emblem">🎁</div>
        <div class="pack-foil-sub">${pack.cost_points} PONTOS</div>
      </div>
      <div class="pack-bottom-crimp"></div>
    `;
    container.appendChild(packEl);
  });
}

// CERIMÔNIA DE UNBOXING COM DRAMA, SUSPENSE, EFEITOS SONOROS E FLASHBANG
async function startUnboxingCeremony(pack) {
  if (globalPoints < pack.cost_points) {
    return alert("Pontos insuficientes para comprar este pacote!");
  }

  if (allStickers.length === 0) {
    return alert("Não há figurinhas cadastradas para sorteio.");
  }

  // 1. Prepara os elementos da Cerimônia de Unboxing
  const ceremonyOverlay = document.getElementById("loot-ceremony-overlay");
  const ceremonyPackTitle = document.getElementById("ceremony-pack-title");
  const unboxingPack = document.querySelector(".unboxing-pack");

  if (ceremonyPackTitle) ceremonyPackTitle.innerText = pack.pack_name.toUpperCase();

  // 2. Ativa o palco da cerimônia e INICIA O TREME-TREME do pacote
  unboxingPack.className = "unboxing-pack suspense-shake";
  ceremonyOverlay.classList.add("active");

  // 🎵 SOM DE COMPRA: Disparado INSTANTANEAMENTE ao começar a tremer!
  playAudio(buySound);

  // 3. Debita pontos no banco de dados em segundo plano
  globalPoints -= pack.cost_points;
  updatePointsDisplay();

  supabaseClient
    .from("profiles")
    .update({ global_points: globalPoints })
    .eq("id", currentUser.id);

  // ETAPA 1 (0.0s - 2.0s): Tremores frenéticos e acúmulo de energia neon
  setTimeout(() => {
    // ETAPA 2 (2.0s): O pacote rasga e explode luz de dentro
    unboxingPack.className = "unboxing-pack tear-open";
  }, 2000);

  // ETAPA 3 (2.5s): FLASHBANG NEON DE ALTA INTENSIDADE
  setTimeout(() => {
    const flashEl = document.getElementById("flash");
    if (flashEl) {
      flashEl.classList.add("active");
      setTimeout(() => flashEl.classList.remove("active"), 350);
    }
  }, 2500);

  // ETAPA 4 (2.8s): Sorteio no banco de dados, Som do Loot e Abertura do Modal de Revelação
  setTimeout(async () => {
    const randomIndex = Math.floor(Math.random() * allStickers.length);
    const drawnSticker = allStickers[randomIndex];

    const currentQty = userInventory[drawnSticker.id] || 0;
    const isNew = currentQty === 0;

    userInventory[drawnSticker.id] = currentQty + 1;

    await supabaseClient
      .from("user_stickers")
      .upsert({
        user_id: currentUser.id,
        sticker_id: drawnSticker.id,
        quantity: userInventory[drawnSticker.id],
        updated_at: new Date().toISOString()
      }, { onConflict: "user_id, sticker_id" });

    // 🎵 SOM DE LOOTBOX: Disparado na revelação da figurinha
    playAudio(lootSound);

    // Fecha a cerimônia de unboxing e abre a revelação
    ceremonyOverlay.classList.remove("active");
    showRevealModal(drawnSticker, isNew);
  }, 2800);
}

// MODAL DE REVELAÇÃO DA FIGURINHA SORTEADA
function showRevealModal(sticker, isNew) {
  const overlay = document.getElementById("reveal-overlay");
  const badgeContainer = document.getElementById("loot-badge-container");
  const container = document.getElementById("revealed-card-container");
  const btnCollect = document.getElementById("btn-collect");

  if (!overlay) return;

  badgeContainer.innerHTML = isNew 
    ? `<div class="badge" style="background: #00ffff; color:#000; box-shadow: 0 0 25px #00ffff;">★ FIGURINHA NOVA! ★</div>`
    : `<div class="badge" style="background: #ff9800; color:#000; box-shadow: 0 0 25px #ff9800;">REPETIDA (+1)</div>`;

  btnCollect.innerText = isNew ? "COLAR NO ÁLBUM" : "GUARDAR NO INVENTÁRIO";

  container.innerHTML = `
    <div class="large-card rarity-${sticker.rarity}">
      <img src="${sticker.image_url}" alt="${sticker.title}">
      <div class="card-title" style="color: #00ffff; margin-top: 12px; font-family:'Press Start 2P'; font-size: 0.85rem;">#${sticker.id} - ${sticker.title}</div>
    </div>
  `;

  overlay.classList.add("active");

  // Explosão Sequencial de Confetes
  if (window.confetti) {
    confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
    setTimeout(() => {
      confetti({ particleCount: 100, angle: 60, spread: 60, origin: { x: 0 } });
      confetti({ particleCount: 100, angle: 120, spread: 60, origin: { x: 1 } });
    }, 300);
  }
}

function closeReveal() {
  document.getElementById("reveal-overlay")?.classList.remove("active");
  renderAlbum();
}

function openInspect(sticker) {
  const overlay = document.getElementById("inspect-overlay");
  const container = document.getElementById("inspect-card-container");

  if (!overlay) return;

  container.innerHTML = `
    <div class="inspect-box rarity-${sticker.rarity}">
      <img src="${sticker.image_url}" alt="${sticker.title}">
      <div class="card-title" style="color: #00ffff; margin-top: 12px; font-family:'Press Start 2P'; font-size: 0.85rem;">#${sticker.id} - ${sticker.title}</div>
      <p style="color: #aaa; font-size: 0.75rem; margin-top: 8px;">Raridade: ${sticker.rarity.toUpperCase()}</p>
    </div>
  `;

  overlay.classList.add("active");
}

function closeInspect() {
  document.getElementById("inspect-overlay")?.classList.remove("active");
}

// SUPERADMIN - CADASTRO DE FIGURINHAS
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
