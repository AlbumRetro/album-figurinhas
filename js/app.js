// CONFIGURAÇÃO DO CLIENTE SUPABASE
const SUPABASE_URL = "https://bysyjbuqdeayxoryrjmj.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_FCdyKbtrv_-59kkIcd9xRg_gtFXE4ny";

// Evita conflito de nomes usando supabaseClient
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ESTADO GLOBAL DA APLICAÇÃO
let currentUser = null;
let globalPoints = 0;
let userInventory = {}; // { 'ZE-001': quantity }
let allStickers = [];
let availablePacks = [];

// INICIALIZAÇÃO
document.addEventListener("DOMContentLoaded", async () => {
  // Check para ver se o utilizador já está autenticado via Google / Supabase Auth
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    await initAuthenticatedUser(session.user);
  }
});

// FUNÇÃO DE LOGIN COM O GOOGLE (Chamada pelo botão do index.html)
async function loginWithGoogle() {
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.href
    }
  });
  if (error) alert("Erro ao autenticar com o Google: " + error.message);
}

// CARREGA O PERFIL DO UTILIZADOR AUTENTICADO
async function initAuthenticatedUser(authUser) {
  let { data: profile, error } = await supabaseClient
    .from("profiles")
    .select("*")
    .eq("id", authUser.id)
    .single();

  if (error && error.code === "PGRST116") {
    // Perfil não existe -> Criar novo com 1000 pontos padrão
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

// CARREGAMENTO DE DADOS DO BANCO
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
        userInventory[item.sticker_id] = item.quantity;
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
    const isUnlocked = count > 0;
    if (isUnlocked) coladas++;

    const card = document.createElement("div");
    card.className = `card rarity-${sticker.rarity} ${isUnlocked ? '' : 'locked'}`;
    if (isUnlocked) card.onclick = () => openInspect(sticker);

    card.innerHTML = `
      <img src="${sticker.image_url}" alt="${sticker.title}">
      <div class="card-title">#${sticker.id}</div>
    `;
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
    totalPossuidas += count;

    if (count > 0) {
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

// LOJA E ABERTURA DE PACOTES
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
    packEl.onclick = () => buyPack(pack);

    packEl.innerHTML = `
      <div class="pack-main-title">${pack.pack_name}</div>
      <div style="font-size: 2rem;">📦</div>
      <div class="pack-cost">${pack.cost_points} PTS</div>
    `;
    container.appendChild(packEl);
  });
}

async function buyPack(pack) {
  if (globalPoints < pack.cost_points) {
    return alert("Pontos insuficientes para comprar este pacote!");
  }

  if (allStickers.length === 0) {
    return alert("Não há figurinhas cadastradas para sorteio.");
  }

  globalPoints -= pack.cost_points;
  updatePointsDisplay();

  await supabaseClient
    .from("profiles")
    .update({ global_points: globalPoints })
    .eq("id", currentUser.id);

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

  showRevealModal(drawnSticker, isNew);
}

// MODAL DE REVELAÇÃO E INSPEÇÃO
function showRevealModal(sticker, isNew) {
  const overlay = document.getElementById("reveal-overlay");
  const badgeContainer = document.getElementById("loot-badge-container");
  const container = document.getElementById("revealed-card-container");
  const btnCollect = document.getElementById("btn-collect");

  if (!overlay) return;

  badgeContainer.innerHTML = isNew 
    ? `<div class="badge" style="background: #00ffff; color:#000;">★ FIGURINHA NOVA! ★</div>`
    : `<div class="badge" style="background: #ff9800; color:#000;">REPETIDA (+1)</div>`;

  btnCollect.innerText = isNew ? "COLAR NO ÁLBUM" : "GUARDAR NO INVENTÁRIO";

  container.innerHTML = `
    <div class="large-card rarity-${sticker.rarity}">
      <img src="${sticker.image_url}" alt="${sticker.title}">
      <div class="card-title" style="color: #00ffff; margin-top: 10px; font-family:'Press Start 2P'; font-size: 0.8rem;">#${sticker.id} - ${sticker.title}</div>
    </div>
  `;

  overlay.classList.add("active");
  if (window.confetti) confetti({ particleCount: 80, spread: 70, origin: { y: 0.6 } });
}

function closeReveal() {
  document.getElementById("reveal-overlay")?.classList.remove("active");
}

function openInspect(sticker) {
  const overlay = document.getElementById("inspect-overlay");
  const container = document.getElementById("inspect-card-container");

  if (!overlay) return;

  container.innerHTML = `
    <div class="inspect-box rarity-${sticker.rarity}">
      <img src="${sticker.image_url}" alt="${sticker.title}">
      <div class="card-title" style="color: #00ffff; margin-top: 10px; font-family:'Press Start 2P'; font-size: 0.8rem;">#${sticker.id} - ${sticker.title}</div>
      <p style="color: #aaa; font-size: 0.75rem; margin-top: 5px;">Raridade: ${sticker.rarity.toUpperCase()}</p>
    </div>
  `;

  overlay.classList.add("active");
}

function closeInspect() {
  document.getElementById("inspect-overlay")?.classList.remove("active");
}

// FUNCIONALIDADE DO SUPERADMIN
async function createStickerBySuperadmin() {
  if (!currentUser || currentUser.role !== "superadmin") {
    return alert("Acesso negado: apenas o Superadmin pode cadastrar e aprovar figurinhas.");
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

  alert("Figurinha cadastrada e aprovada com sucesso!");
  await loadCatalogAndInventory();
  renderAlbum();
}
