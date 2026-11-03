// URL PERMANENTE DA API (Google Apps Script)
const API_URL = "https://script.google.com/macros/s/AKfycbxVg5kQYBcy-1jtGN52ooXfN85-esDtqNXHaobRxDsg7Ep4MA7tg6w8BLeT1gWXF-Pv/exec";

let purchasesData = [];
let fichasMap = {}, empenhosMap = {}, notasMap = {}, liquidacoesMap = {};
let anexosReqMap = {}, anexosAfMap = {}, anexosNfMap = {}, anexosNlMap = {};
let cadLocais = [], cadEventos = [], cadAnos = [];

let currentTags = { ficha: [], empenho: [], nf: [], nl: [] };
let currentFiles = { req: [], af: [], nf: [], nl: [] };

// Controladores de Ordenação
let currentSortColumn = 'protocolo';
let currentSortDirection = 'asc';

function parseValorNum(val) {
  if (!val && val !== 0) return 0.0;
  if (typeof val === 'number') return val;
  let cleanStr = val.toString().replace('R$', '').replace(/\./g, '').replace(',', '.').trim();
  let num = parseFloat(cleanStr);
  return isNaN(num) ? 0.0 : num;
}

function parseBool(val) {
  if (typeof val === 'boolean') return val;
  return String(val).toLowerCase() === 'true';
}

function formatDateBR(val) {
  if (!val) return '-';
  let str = val.toString().trim();
  if (str.includes('T')) str = str.split('T')[0];
  if (str.includes('-')) {
    let parts = str.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return str;
}

function extractYearFromItem(item) {
  let dateStr = item.DATA_PROCESSO || item.ENTREGA || '';
  if (dateStr) {
    let cleanStr = dateStr.toString().split('T')[0];
    if (cleanStr.includes('-')) return cleanStr.split('-')[0];
    if (cleanStr.includes('/')) return cleanStr.split('/')[2];
  }
  return new Date().getFullYear().toString();
}

function calculatePaymentForecast(entregaStr) {
  if (!entregaStr) return null;
  let parts = entregaStr.split('T')[0].split('-');
  if (parts.length !== 3) return null;

  let year = parseInt(parts[0], 10);
  let month = parseInt(parts[1], 10) - 1;
  let day = parseInt(parts[2], 10);

  let dtEntrega = new Date(Date.UTC(year, month, day));
  if (isNaN(dtEntrega.getTime())) return null;

  dtEntrega.setUTCDate(dtEntrega.getUTCDate() + 28);
  let dayOfWeek = dtEntrega.getUTCDay();
  let daysUntilThursday = (4 - dayOfWeek + 7) % 7;
  dtEntrega.setUTCDate(dtEntrega.getUTCDate() + daysUntilThursday);

  let resDay = String(dtEntrega.getUTCDate()).padStart(2, '0');
  let resMonth = String(dtEntrega.getUTCMonth() + 1).padStart(2, '0');
  let resYear = dtEntrega.getUTCFullYear();

  return `${resDay}/${resMonth}/${resYear}`;
}

function parseBRDateToUTC(dateBRStr) {
  if (!dateBRStr || dateBRStr === '-') return null;
  let parts = dateBRStr.split('/');
  if (parts.length !== 3) return null;
  return new Date(Date.UTC(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10)));
}

document.addEventListener('DOMContentLoaded', () => {
  initTheme();
  loadData();
  setupEventListeners();
  setupTableHeaderSort();
});

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  if (savedTheme === 'dark') {
    document.body.classList.add('dark-mode');
    const toggleBtn = document.getElementById('theme-toggle');
    if (toggleBtn) toggleBtn.innerText = '☀️ Modo Claro';
  }
}

function toggleTheme() {
  document.body.classList.toggle('dark-mode');
  const isDark = document.body.classList.contains('dark-mode');
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
  const toggleBtn = document.getElementById('theme-toggle');
  if (toggleBtn) toggleBtn.innerText = isDark ? '☀️ Modo Claro' : '🌙 Modo Escuro';
}

async function loadData() {
  const tbody = document.getElementById('table-body');
  if (tbody) tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 2rem;">🔄 Carregando dados da planilha...</td></tr>`;

  try {
    const response = await fetch(API_URL, { redirect: 'follow' });
    if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);

    const data = await response.json();

    function buildRelMap(list) {
      let map = {};
      if (list && Array.isArray(list)) {
        list.forEach(item => {
          let keys = Object.keys(item);
          if (keys.length === 0) return;

          let id = item.ID_SOLICITACAO;
          if (!id) {
            for (let k of keys) {
              if (String(item[k]).trim().startsWith('SOL')) {
                id = item[k];
                break;
              }
            }
          }

          let val = item.NUMERO_FICHA || item.NUMERO_EMPENHO || item.NUMERO_NF || item.NUMERO_NL;
          if (!val) {
            for (let k of keys) {
              let v = String(item[k]).trim();
              if (v && v !== String(id).trim() && !v.startsWith('FIC') && !v.startsWith('EMP') && !v.startsWith('NF') && !v.startsWith('NL')) {
                val = v;
                break;
              }
            }
          }

          if (id && val) {
            id = String(id).trim();
            val = String(val).trim();
            if (!map[id]) map[id] = [];
            if (!map[id].includes(val)) map[id].push(val);
          }
        });
      }
      return map;
    }

    function buildAnexosMap(list) {
      let map = {};
      if (list && Array.isArray(list)) {
        list.forEach(item => {
          let id = String(item.ID_SOLICITACAO || '').trim();
          let url = item.URL_DRIVE || '';
          let name = item.NOME_ARQUIVO || 'Anexo';

          if (id && url) {
            if (!map[id]) map[id] = [];
            map[id].push({ name: name, url: url });
          }
        });
      }
      return map;
    }

    fichasMap = buildRelMap(data.fichas);
    empenhosMap = buildRelMap(data.empenhos);
    notasMap = buildRelMap(data.notasFiscais);
    liquidacoesMap = buildRelMap(data.liquidacoes);

    anexosReqMap = buildAnexosMap(data.anexosReq);
    anexosAfMap = buildAnexosMap(data.anexosAf);
    anexosNfMap = buildAnexosMap(data.anexosNf);
    anexosNlMap = buildAnexosMap(data.anexosNl);

    let rawLocais = (data.locais || []).map(l => l.NOME_LOCAL).filter(Boolean);
    let rawEventos = (data.eventos || []).map(e => e.NOME_EVENTO).filter(Boolean);

    purchasesData = (data.solicitacoes || []).map(item => {
      let solId = String(item.ID_SOLICITACAO || '').trim();

      let reqList = anexosReqMap[solId] ? [...anexosReqMap[solId]] : [];
      if (reqList.length === 0 && item.ANEXO_REQUISICAO) {
        reqList.push({ name: 'Anexo Requisição', url: item.ANEXO_REQUISICAO });
      }

      let afList = anexosAfMap[solId] ? [...anexosAfMap[solId]] : [];
      if (afList.length === 0 && item.ANEXO_AF_OS) {
        afList.push({ name: 'Anexo AF/OS', url: item.ANEXO_AF_OS });
      }

      let yearExtracted = extractYearFromItem(item);

      return {
        id: solId,
        protocolo: item.PROTOCOLO || '',
        evento: item.EVENTO || '',
        local: item.LOCAL || '',
        descritivo: item.DESCRITIVO || '',
        requisicao: item.REQUISICAO || '',
        fichas: fichasMap[solId] || [],
        empenhos: empenhosMap[solId] || [],
        notas: notasMap[solId] || [],
        nl: liquidacoesMap[solId] || [],
        valor: parseValorNum(item.VALOR_TOTAL),
        af: item.AF_OS || '',
        entrega: item.ENTREGA || '',
        dataProcesso: item.DATA_PROCESSO || '',
        ano: yearExtracted,
        almox: parseBool(item.CHK_ALMOXARIFADO),
        contab: parseBool(item.CHK_CONTABILIDADE),
        cancelado: parseBool(item.CHK_CANCELADO),
        anexosReq: reqList,
        anexosAf: afList,
        anexosNf: anexosNfMap[solId] || [],
        anexosNl: anexosNlMap[solId] || []
      };
    });

    cadLocais = [...new Set([...rawLocais, ...purchasesData.map(d => d.local).filter(Boolean)])].sort();
    cadEventos = [...new Set([...rawEventos, ...purchasesData.map(d => d.evento).filter(Boolean)])].sort();
    
    // Lista os anos encontrados e garante o ano corrente na lista
    const currentYearStr = new Date().getFullYear().toString();
    cadAnos = [...new Set([currentYearStr, ...purchasesData.map(d => d.ano).filter(Boolean)])].sort((a,b) => b - a);

    populateFilterOptions();
    applyFilters();

  } catch (error) {
    console.error("Erro ao carregar dados:", error);
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; color: #dc2626; padding: 2rem;">❌ Erro ao conectar com o Google Sheets.</td></tr>`;
    }
  }
}

// ATUALIZAÇÃO DOS KPIS COM FORMATO (CONCLUÍDAS / TOTAL)
function updateKPIs(data) {
  const totalQtdEl = document.getElementById('kpi-total-qtd');
  const totalValorEl = document.getElementById('kpi-total-valor');

  // Considera concluída se estiver no Almoxarifado ou na Contabilidade (e não cancelada)
  const concluidos = data.filter(i => (i.almox || i.contab) && !i.cancelado).length;
  const total = data.length;

  if (totalQtdEl) {
    totalQtdEl.innerText = `${concluidos} / ${total}`;
  }

  if (totalValorEl) {
    let totalValor = data.reduce((sum, item) => sum + (item.cancelado ? 0 : item.valor), 0);
    totalValorEl.innerText = totalValor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  }
}

function populateFilterOptions() {
  const filterAno = document.getElementById('filter-ano');
  const filterLocal = document.getElementById('filter-local');
  const filterEvento = document.getElementById('filter-evento');
  const formLocal = document.getElementById('form-local');
  const formEvento = document.getElementById('form-evento');

  const currentYearStr = new Date().getFullYear().toString();

  if (filterAno) {
    filterAno.innerHTML = '<option value="">Todos os Anos</option>';
    cadAnos.forEach(ano => {
      let selected = ano === currentYearStr ? 'selected' : '';
      filterAno.innerHTML += `<option value="${ano}" ${selected}>Ano ${ano}</option>`;
    });
  }

  if (filterLocal) filterLocal.innerHTML = '<option value="">Todos os Locais</option>';
  if (filterEvento) filterEvento.innerHTML = '<option value="">Todos os Eventos</option>';
  if (formLocal) formLocal.innerHTML = '<option value="">Selecione o Local</option>';
  if (formEvento) formEvento.innerHTML = '<option value="">Selecione o Evento</option>';

  cadLocais.forEach(loc => {
    if (filterLocal) filterLocal.innerHTML += `<option value="${loc}">${loc}</option>`;
    if (formLocal) formLocal.innerHTML += `<option value="${loc}">${loc}</option>`;
  });

  cadEventos.forEach(evt => {
    if (filterEvento) filterEvento.innerHTML += `<option value="${evt}">${evt}</option>`;
    if (formEvento) formEvento.innerHTML += `<option value="${evt}">${evt}</option>`;
  });
}

function setupTableHeaderSort() {
  const headers = document.querySelectorAll('#purchases-table th.sortable');
  headers.forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort');
      if (currentSortColumn === col) {
        currentSortDirection = currentSortDirection === 'asc' ? 'desc' : 'asc';
      } else {
        currentSortColumn = col;
        currentSortDirection = 'asc';
      }
      updateSortHeaderUI();
      applyFilters();
    });
  });
  updateSortHeaderUI();
}

function updateSortHeaderUI() {
  document.querySelectorAll('#purchases-table th.sortable').forEach(th => {
    const col = th.getAttribute('data-sort');
    const icon = th.querySelector('.sort-icon');
    th.classList.remove('sort-asc', 'sort-desc');

    if (col === currentSortColumn) {
      if (currentSortDirection === 'asc') {
        th.classList.add('sort-asc');
        if (icon) icon.innerText = '▲';
      } else {
        th.classList.add('sort-desc');
        if (icon) icon.innerText = '▼';
      }
    } else {
      if (icon) icon.innerText = '↕';
    }
  });
}

function sortData(list) {
  return list.sort((a, b) => {
    let valA, valB;

    switch (currentSortColumn) {
      case 'protocolo':
        valA = parseFloat(a.protocolo.toString().replace(/[^0-9.]/g, '')) || 0;
        valB = parseFloat(b.protocolo.toString().replace(/[^0-9.]/g, '')) || 0;
        break;
      case 'requisicao':
        valA = parseFloat(a.requisicao) || 0;
        valB = parseFloat(b.requisicao) || 0;
        break;
      case 'af':
        valA = parseFloat(a.af) || 0;
        valB = parseFloat(b.af) || 0;
        break;
      case 'valor':
        valA = a.valor || 0;
        valB = b.valor || 0;
        break;
      case 'prevPagamento':
        let strA = calculatePaymentForecast(a.entrega);
        let strB = calculatePaymentForecast(b.entrega);
        let dtA = parseBRDateToUTC(strA);
        let dtB = parseBRDateToUTC(strB);
        valA = dtA ? dtA.getTime() : 0;
        valB = dtB ? dtB.getTime() : 0;
        break;
      case 'status':
        valA = a.cancelado ? 4 : (a.contab ? 3 : (a.almox ? 2 : 1));
        valB = b.cancelado ? 4 : (b.contab ? 3 : (b.almox ? 2 : 1));
        break;
      case 'evento':
        valA = (a.evento + " " + a.local).toLowerCase();
        valB = (b.evento + " " + b.local).toLowerCase();
        break;
      default:
        valA = (a[currentSortColumn] || '').toString().toLowerCase();
        valB = (b[currentSortColumn] || '').toString().toLowerCase();
        break;
    }

    if (valA < valB) return currentSortDirection === 'asc' ? -1 : 1;
    if (valA > valB) return currentSortDirection === 'asc' ? 1 : -1;
    return 0;
  });
}

function renderTable(data) {
  const tbody = document.getElementById('table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  if (data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" style="text-align:center; padding: 2rem;">Nenhum registro encontrado.</td></tr>`;
    return;
  }

  data.forEach(item => {
    let badgeHtml = '';
    let rowClass = '';

    if (item.cancelado) {
      badgeHtml = `<span class="badge badge-red">Cancelado</span>`;
      rowClass = 'status-row-red';
    } else if (item.contab) {
      badgeHtml = `<span class="badge badge-blue">Contabilidade</span>`;
      rowClass = 'status-row-blue';
    } else if (item.almox) {
      badgeHtml = `<span class="badge badge-green">Almoxarifado</span>`;
      rowClass = 'status-row-green';
    } else {
      badgeHtml = `<span class="badge badge-orange">Aguardando</span>`;
      rowClass = 'status-row-orange';
    }

    let strFichas = item.fichas.length ? item.fichas.join(', ') : '-';
    let strEmpenhos = item.empenhos.length ? item.empenhos.join(', ') : '-';
    let strNotas = item.notas.length ? item.notas.join(', ') : '-';
    let strNl = item.nl.length ? item.nl.join(', ') : '-';

    let prevPagamento = calculatePaymentForecast(item.entrega);
    let strPrevPagamento = prevPagamento ? prevPagamento : '-';

    tbody.innerHTML += `
      <tr class="${rowClass} clickable-row" onclick="editRecord('${item.id}')" title="Clique para explorar / editar o protocolo ${item.protocolo}">
        <td><strong>${item.protocolo}</strong></td>
        <td>${item.evento || '-'}<br><small style="opacity: 0.7">${item.local || '-'}</small></td>
        <td>${item.descritivo}</td>
        <td>${item.requisicao || '-'}</td>
        <td>${strFichas}</td>
        <td>${strEmpenhos}</td>
        <td>${item.af || '-'}</td>
        <td>${item.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</td>
        <td>${strNotas}</td>
        <td>${strNl}</td>
        <td><strong>${strPrevPagamento}</strong></td>
        <td>${badgeHtml}</td>
      </tr>
    `;
  });
}

function setupEventListeners() {
  const form = document.getElementById('purchase-form');
  if (form) {
    form.addEventListener('submit', handleFormSubmit);

    form.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        if (e.target.id && e.target.id.startsWith('input-tag-')) {
          const tagType = e.target.id.replace('input-tag-', '');
          addTag(tagType);
        }
      }
    });
  }

  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') applyFilters();
    });
  }

  const filterAno = document.getElementById('filter-ano');
  const filterLocal = document.getElementById('filter-local');
  const filterEvento = document.getElementById('filter-evento');
  const filterStatus = document.getElementById('filter-status');

  if (filterAno) filterAno.addEventListener('change', applyFilters);
  if (filterLocal) filterLocal.addEventListener('change', applyFilters);
  if (filterEvento) filterEvento.addEventListener('change', applyFilters);
  if (filterStatus) filterStatus.addEventListener('change', applyFilters);

  const entregaInput = document.getElementById('form-entrega');
  if (entregaInput) {
    entregaInput.addEventListener('change', (e) => {
      updatePrevisaoBanner(e.target.value);
    });
  }
}

function updatePrevisaoBanner(entregaVal) {
  const boxBanner = document.getElementById('box-previsao-pagamento');
  const tagData = document.getElementById('tag-previsao-data');
  
  const previsaoStr = calculatePaymentForecast(entregaVal);
  if (previsaoStr) {
    if (tagData) tagData.innerText = previsaoStr;
    if (boxBanner) boxBanner.style.display = 'flex';
  } else {
    if (boxBanner) boxBanner.style.display = 'none';
  }
}

function getFilteredData() {
  const searchInput = document.getElementById('search-input');
  const filterAno = document.getElementById('filter-ano');
  const filterLocal = document.getElementById('filter-local');
  const filterEvento = document.getElementById('filter-evento');
  const filterStatus = document.getElementById('filter-status');

  const search = searchInput ? searchInput.value.toLowerCase().trim() : '';
  const ano = filterAno ? filterAno.value : '';
  const local = filterLocal ? filterLocal.value : '';
  const evento = filterEvento ? filterEvento.value : '';
  const status = filterStatus ? filterStatus.value : '';

  const today = new Date();
  const todayUTC = new Date(Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()));

  return purchasesData.filter(item => {
    let strFichas = item.fichas.join(' ').toLowerCase();
    let strEmpenhos = item.empenhos.join(' ').toLowerCase();
    let strNotas = item.notas.join(' ').toLowerCase();
    let strNl = item.nl.join(' ').toLowerCase();

    let matchSearch = !search || 
                      item.protocolo.toString().toLowerCase().includes(search) || 
                      item.descritivo.toString().toLowerCase().includes(search) ||
                      item.evento.toString().toLowerCase().includes(search) ||
                      item.local.toString().toLowerCase().includes(search) ||
                      item.requisicao.toString().toLowerCase().includes(search) ||
                      item.af.toString().toLowerCase().includes(search) ||
                      strFichas.includes(search) ||
                      strEmpenhos.includes(search) ||
                      strNotas.includes(search) ||
                      strNl.includes(search);
    
    let matchAno = !ano || item.ano === ano;
    let matchLocal = !local || item.local === local;
    let matchEvento = !evento || item.evento === evento;
    
    let matchStatus = true;
    if (status === 'A_VENCER') {
      let prevPag = calculatePaymentForecast(item.entrega);
      let dtPrev = parseBRDateToUTC(prevPag);
      matchStatus = !item.cancelado && dtPrev !== null && dtPrev >= todayUTC;
    } else if (status === 'CANCELADO') {
      matchStatus = item.cancelado;
    } else if (status === 'CONTABILIDADE') {
      matchStatus = item.contab && !item.cancelado;
    } else if (status === 'ALMOXARIFADO') {
      matchStatus = item.almox && !item.cancelado;
    } else if (status === 'AGUARDANDO') {
      matchStatus = !item.almox && !item.contab && !item.cancelado;
    }

    return matchSearch && matchAno && matchLocal && matchEvento && matchStatus;
  });
}

function applyFilters() {
  let filtered = getFilteredData();
  let sorted = sortData(filtered);
  renderTable(sorted);
  updateKPIs(sorted);
}

// EXPORTAÇÃO DOS DADOS FILTRADOS PARA EXCEL (.XLSX)
function exportToExcel() {
  let filtered = getFilteredData();
  let dataToExport = sortData(filtered);

  if (dataToExport.length === 0) {
    alert("Nenhum registro encontrado para exportar com os filtros atuais.");
    return;
  }

  const excelData = dataToExport.map(item => {
    let statusTexto = item.cancelado ? 'Cancelado' : (item.contab ? 'Contabilidade' : (item.almox ? 'Almoxarifado' : 'Aguardando'));
    let prevPagamento = calculatePaymentForecast(item.entrega) || '-';

    return {
      "Ano": item.ano,
      "Protocolo": item.protocolo,
      "Evento": item.evento,
      "Local": item.local,
      "Descritivo": item.descritivo,
      "Requisição": item.requisicao,
      "Ficha(s)": item.fichas.join(', '),
      "Empenho(s)": item.empenhos.join(', '),
      "AF/OS": item.af,
      "Valor (R$)": item.valor,
      "Nota(s) Fiscal(is)": item.notas.join(', '),
      "Liquidação(ões) NL": item.nl.join(', '),
      "Data Entrega": formatDateBR(item.entrega),
      "Data Processo": formatDateBR(item.dataProcesso),
      "Prev. Pagamento": prevPagamento,
      "Status": statusTexto
    };
  });

  const worksheet = XLSX.utils.json_to_sheet(excelData);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Solicitações Filtradas");

  const max_width = excelData.reduce((w, r) => Math.max(w, (r.Descritivo || '').length), 10);
  worksheet['!cols'] = [
    { wch: 8 }, { wch: 12 }, { wch: 20 }, { wch: 20 }, { wch: Math.min(max_width, 50) },
    { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 10 }, { wch: 14 },
    { wch: 15 }, { wch: 15 }, { wch: 12 }, { wch: 12 }, { wch: 14 }, { wch: 15 }
  ];

  const todayStr = new Date().toISOString().split('T')[0];
  XLSX.writeFile(workbook, `Relatorio_Compras_SECTUR_${todayStr}.xlsx`);
}

// TAGS
function addTag(type) {
  const input = document.getElementById(`input-tag-${type}`);
  if (!input) return;
  const val = input.value.trim();
  if (val && !currentTags[type].includes(val)) {
    currentTags[type].push(val);
    renderTags(type);
    input.value = '';
  }
  input.focus();
}

function removeTag(type, val) {
  currentTags[type] = currentTags[type].filter(item => item !== val);
  renderTags(type);
  const input = document.getElementById(`input-tag-${type}`);
  if (input) input.focus();
}

function renderTags(type) {
  const container = document.getElementById(`tags-${type}`);
  if (!container) return;
  container.innerHTML = '';
  currentTags[type].forEach(val => {
    container.innerHTML += `<span class="tag-chip">${val} <button type="button" onclick="removeTag('${type}', '${val}')">×</button></span>`;
  });
}

// GESTÃO E ANEXOS MULTIPLOS
function handleFileSelect(event, type) {
  const files = Array.from(event.target.files);
  files.forEach(file => {
    currentFiles[type].push({
      fileObj: file,
      name: file.name,
      mime: file.type,
      isNew: true
    });
  });
  renderFileChips(type);
  event.target.value = '';
}

function removeFile(type, index) {
  currentFiles[type].splice(index, 1);
  renderFileChips(type);
}

function renderFileChips(type) {
  const container = document.getElementById(`list-files-${type}`);
  if (!container) return;
  container.innerHTML = '';

  currentFiles[type].forEach((item, index) => {
    if (item.url) {
      container.innerHTML += `
        <div class="file-chip">
          <a href="${item.url}" target="_blank" title="${item.name}">🔗 ${item.name}</a>
          <button type="button" onclick="removeFile('${type}', ${index})">×</button>
        </div>`;
    } else {
      container.innerHTML += `
        <div class="file-chip">
          <span class="file-name" title="${item.name}">📄 ${item.name}</span>
          <button type="button" onclick="removeFile('${type}', ${index})">×</button>
        </div>`;
    }
  });
}

function resetModalScroll() {
  const modalContent = document.querySelector('#form-modal .modal-content') || document.querySelector('#form-modal > div');
  if (modalContent) modalContent.scrollTop = 0;
  const formModal = document.getElementById('form-modal');
  if (formModal) formModal.scrollTop = 0;
}

function openModal() {
  const form = document.getElementById('purchase-form');
  if (form) form.reset();
  
  document.getElementById('form-id').value = '';
  const boxBanner = document.getElementById('box-previsao-pagamento');
  if (boxBanner) boxBanner.style.display = 'none';
  
  currentTags = { ficha: [], empenho: [], nf: [], nl: [] };
  ['ficha', 'empenho', 'nf', 'nl'].forEach(renderTags);

  currentFiles = { req: [], af: [], nf: [], nl: [] };
  ['req', 'af', 'nf', 'nl'].forEach(renderFileChips);

  const deleteBtn = document.getElementById('btn-delete-record');
  if (deleteBtn) deleteBtn.style.display = 'none';

  document.getElementById('modal-title').innerText = 'Nova Solicitação de Compra';
  document.getElementById('form-modal').style.display = 'flex';

  resetModalScroll();
}

function closeModal() {
  document.getElementById('form-modal').style.display = 'none';
}

function editRecord(id) {
  const item = purchasesData.find(d => d.id === id);
  if (!item) return;

  document.getElementById('form-id').value = item.id;
  document.getElementById('form-protocolo').value = item.protocolo;
  document.getElementById('form-requisicao').value = item.requisicao;
  document.getElementById('form-af').value = item.af;
  document.getElementById('form-evento').value = item.evento;
  document.getElementById('form-local').value = item.local;
  document.getElementById('form-descritivo').value = item.descritivo;
  document.getElementById('form-valor').value = item.valor;
  document.getElementById('form-entrega').value = item.entrega;
  document.getElementById('form-data-processo').value = item.dataProcesso;
  document.getElementById('form-chk-almox').checked = item.almox;
  document.getElementById('form-chk-contab').checked = item.contab;
  document.getElementById('form-chk-cancelado').checked = item.cancelado;

  updatePrevisaoBanner(item.entrega);

  currentTags = {
    ficha: [...item.fichas],
    empenho: [...item.empenhos],
    nf: [...item.notas],
    nl: [...item.nl]
  };
  ['ficha', 'empenho', 'nf', 'nl'].forEach(renderTags);

  currentFiles = {
    req: item.anexosReq ? [...item.anexosReq] : [],
    af: item.anexosAf ? [...item.anexosAf] : [],
    nf: item.anexosNf ? [...item.anexosNf] : [],
    nl: item.anexosNl ? [...item.anexosNl] : []
  };
  ['req', 'af', 'nf', 'nl'].forEach(renderFileChips);

  let deleteBtn = document.getElementById('btn-delete-record');
  if (!deleteBtn) {
    deleteBtn = document.createElement('button');
    deleteBtn.id = 'btn-delete-record';
    deleteBtn.type = 'button';
    deleteBtn.className = 'btn btn-danger';
    deleteBtn.style.cssText = 'background-color: #dc2626; color: white; border: none; padding: 0.5rem 1rem; border-radius: 6px; cursor: pointer; margin-right: auto;';
    deleteBtn.innerText = '🗑️ Excluir Registro';
    deleteBtn.onclick = confirmAndDeleteRecord;
    
    const actionsDiv = document.querySelector('#purchase-form .form-actions') || document.querySelector('#form-modal .modal-footer');
    if (actionsDiv) actionsDiv.prepend(deleteBtn);
  } else {
    deleteBtn.style.display = 'inline-block';
  }

  document.getElementById('modal-title').innerText = `Explorar / Editar Protocolo ${item.protocolo}`;
  document.getElementById('form-modal').style.display = 'flex';

  resetModalScroll();
}

async function confirmAndDeleteRecord() {
  const id = document.getElementById('form-id').value;
  const protocolo = document.getElementById('form-protocolo').value;

  if (!id) return;

  const confirmed = confirm(`Tem certeza que deseja excluir permanentemente o registro de Protocolo "${protocolo}"?\n\nEsta ação removerá a solicitação e todos os vínculos na planilha.`);
  if (!confirmed) return;

  const deleteBtn = document.getElementById('btn-delete-record');
  if (deleteBtn) deleteBtn.innerText = "Excluindo...";

  try {
    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ ACTION: "DELETE", ID_SOLICITACAO: id })
    });

    closeModal();
    if (deleteBtn) deleteBtn.innerText = "🗑️ Excluir Registro";
    setTimeout(loadData, 1500);

  } catch (err) {
    console.error("Erro ao excluir:", err);
    alert("Erro ao tentar excluir o registro.");
    if (deleteBtn) deleteBtn.innerText = "🗑️ Excluir Registro";
  }
}

// CONVERSÃO RÁPIDA COM COMPRESSÃO AUTOMÁTICA DE IMAGENS
const fileToBase64 = file => new Promise((resolve, reject) => {
  if (file.type.startsWith('image/')) {
    const img = new Image();
    const reader = new FileReader();

    reader.onload = e => {
      img.src = e.target.result;
    };

    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      let width = img.width;
      let height = img.height;
      const maxDim = 1200;

      if (width > maxDim || height > maxDim) {
        if (width > height) {
          height = Math.round((height * maxDim) / width);
          width = maxDim;
        } else {
          width = Math.round((width * maxDim) / height);
          height = maxDim;
        }
      }

      canvas.width = width;
      canvas.height = height;
      ctx.drawImage(img, 0, 0, width, height);

      const dataUrl = canvas.toDataURL('image/jpeg', 0.7);
      resolve(dataUrl.split(',')[1]);
    };

    img.onerror = () => {
      const fallbackReader = new FileReader();
      fallbackReader.readAsDataURL(file);
      fallbackReader.onload = () => resolve(fallbackReader.result.split(',')[1]);
      fallbackReader.onerror = err => reject(err);
    };

    reader.readAsDataURL(file);
  } else {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = error => reject(error);
  }
});

async function processFileList(fileList) {
  return Promise.all(fileList.map(async item => {
    if (item.url) {
      return { name: item.name, url: item.url };
    } else if (item.fileObj) {
      let base64 = await fileToBase64(item.fileObj);
      return {
        name: item.name,
        mime: item.fileObj.type.startsWith('image/') ? 'image/jpeg' : item.mime,
        base64: base64
      };
    }
  }));
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const submitBtn = e.target.querySelector('button[type="submit"]');
  if (submitBtn) {
    submitBtn.innerText = "⚡ Enviando...";
    submitBtn.disabled = true;
  }

  try {
    const [filesReqPayload, filesAfPayload, filesNfPayload, filesNlPayload] = await Promise.all([
      processFileList(currentFiles.req),
      processFileList(currentFiles.af),
      processFileList(currentFiles.nf),
      processFileList(currentFiles.nl)
    ]);

    const payload = {
      ID_SOLICITACAO: document.getElementById('form-id').value.trim() !== "" 
        ? document.getElementById('form-id').value 
        : "SOL" + Date.now(),
      PROTOCOLO: document.getElementById('form-protocolo').value,
      REQUISICAO: document.getElementById('form-requisicao').value,
      AF_OS: document.getElementById('form-af').value,
      EVENTO: document.getElementById('form-evento').value,
      LOCAL: document.getElementById('form-local').value,
      DESCRITIVO: document.getElementById('form-descritivo').value,
      VALOR_TOTAL: parseFloat(document.getElementById('form-valor').value) || 0,
      ENTREGA: document.getElementById('form-entrega').value,
      DATA_PROCESSO: document.getElementById('form-data-processo').value,
      CHK_ALMOXARIFADO: document.getElementById('form-chk-almox').checked,
      CHK_CONTABILIDADE: document.getElementById('form-chk-contab').checked,
      CHK_CANCELADO: document.getElementById('form-chk-cancelado').checked,
      LISTA_FICHAS: currentTags.ficha,
      LISTA_EMPENHOS: currentTags.empenho,
      LISTA_NOTAS: currentTags.nf,
      LISTA_NL: currentTags.nl,
      FILES_REQ: filesReqPayload,
      FILES_AF: filesAfPayload,
      FILES_NF: filesNfPayload,
      FILES_NL: filesNlPayload
    };

    await fetch(API_URL, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(payload)
    });

    closeModal();
    if (submitBtn) {
      submitBtn.innerText = "Salvar Registro";
      submitBtn.disabled = false;
    }
    setTimeout(loadData, 1000);

  } catch (err) {
    console.error("Erro ao salvar:", err);
    alert("Erro ao gravar os dados.");
    if (submitBtn) {
      submitBtn.innerText = "Salvar Registro";
      submitBtn.disabled = false;
    }
  }
}