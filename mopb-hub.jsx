import { useState, useEffect, useCallback } from "react";

const NOTION_TOKEN = "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";
const PROXY = "https://api.allorigins.win/raw?url=";
const NOTION_API = "https://api.notion.com/v1";
const PARENT_PAGE_ID = "37270f5c310e80f3bbdfc03e0e7e19c1";

// ─── Notion API helpers ───────────────────────────────────────────────────────
async function notionRequest(path, method = "GET", body = null) {
  const url = PROXY + encodeURIComponent(`${NOTION_API}${path}`);
  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
      Authorization: `Bearer ${NOTION_TOKEN}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err);
  }
  return res.json();
}

async function findOrCreateDatabase() {
  // Search for existing DB
  const search = await notionRequest("/search", "POST", {
    query: "МОПБ — База материалов",
    filter: { value: "database", property: "object" },
  });
  if (search.results && search.results.length > 0) {
    return search.results[0].id;
  }
  // Create new database
  const db = await notionRequest("/databases", "POST", {
    parent: { type: "page_id", page_id: PARENT_PAGE_ID },
    title: [{ type: "text", text: { content: "МОПБ — База материалов" } }],
    properties: {
      Название: { title: {} },
      Тип: {
        select: {
          options: [
            { name: "Статья", color: "blue" },
            { name: "PDF", color: "red" },
            { name: "Заметка", color: "yellow" },
            { name: "Видео", color: "purple" },
            { name: "НПА", color: "green" },
            { name: "Письмо", color: "orange" },
          ],
        },
      },
      Источник: {
        select: {
          options: [
            { name: "Telegram", color: "blue" },
            { name: "Email", color: "green" },
            { name: "Интернет", color: "gray" },
            { name: "Свой файл", color: "yellow" },
          ],
        },
      },
      Статус: {
        select: {
          options: [
            { name: "Новое", color: "gray" },
            { name: "Изучаю", color: "yellow" },
            { name: "Изучено", color: "green" },
          ],
        },
      },
      Теги: { multi_select: { options: [] } },
      Ссылка: { url: {} },
      Заметки: { rich_text: {} },
    },
  });
  return db.id;
}

async function fetchItems(dbId, filters = {}) {
  const and = [];
  if (filters.status && filters.status !== "Все")
    and.push({ property: "Статус", select: { equals: filters.status } });
  if (filters.type && filters.type !== "Все")
    and.push({ property: "Тип", select: { equals: filters.type } });
  if (filters.source && filters.source !== "Все")
    and.push({ property: "Источник", select: { equals: filters.source } });

  const body = {
    sorts: [{ timestamp: "created_time", direction: "descending" }],
    ...(and.length ? { filter: { and } } : {}),
  };

  const data = await notionRequest(`/databases/${dbId}/query`, "POST", body);
  return data.results || [];
}

async function createItem(dbId, item) {
  const props = {
    Название: { title: [{ text: { content: item.title } }] },
    Тип: { select: { name: item.type } },
    Источник: { select: { name: item.source } },
    Статус: { select: { name: item.status } },
    Заметки: { rich_text: [{ text: { content: item.notes || "" } }] },
  };
  if (item.url) props["Ссылка"] = { url: item.url };
  if (item.tags && item.tags.length)
    props["Теги"] = { multi_select: item.tags.map((t) => ({ name: t })) };

  return notionRequest("/pages", "POST", {
    parent: { database_id: dbId },
    properties: props,
  });
}

async function updateStatus(pageId, status) {
  return notionRequest(`/pages/${pageId}`, "PATCH", {
    properties: { Статус: { select: { name: status } } },
  });
}

async function deleteItem(pageId) {
  return notionRequest(`/pages/${pageId}`, "PATCH", { archived: true });
}

// ─── Parse Notion page to item ────────────────────────────────────────────────
function parseItem(page) {
  const p = page.properties;
  return {
    id: page.id,
    title: p.Название?.title?.[0]?.text?.content || "Без названия",
    type: p.Тип?.select?.name || "",
    source: p.Источник?.select?.name || "",
    status: p.Статус?.select?.name || "Новое",
    url: p.Ссылка?.url || "",
    notes: p.Заметки?.rich_text?.[0]?.text?.content || "",
    tags: p.Теги?.multi_select?.map((t) => t.name) || [],
    created: page.created_time,
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────
const TYPES = ["Все", "Статья", "PDF", "Заметка", "Видео", "НПА", "Письмо"];
const SOURCES = ["Все", "Telegram", "Email", "Интернет", "Свой файл"];
const STATUSES = ["Все", "Новое", "Изучаю", "Изучено"];
const STATUS_NEXT = { Новое: "Изучаю", Изучаю: "Изучено", Изучено: "Новое" };

const TYPE_ICONS = {
  Статья: "📄", PDF: "📕", Заметка: "📝", Видео: "🎬", НПА: "⚖️", Письмо: "✉️",
};
const SOURCE_ICONS = {
  Telegram: "✈️", Email: "📧", Интернет: "🌐", "Свой файл": "💾",
};
const STATUS_COLORS = {
  Новое: "#6b7280", Изучаю: "#d97706", Изучено: "#16a34a",
};

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [dbId, setDbId] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState({ status: "Все", type: "Все", source: "Все", search: "" });
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({ title: "", type: "Статья", source: "Интернет", status: "Новое", url: "", notes: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [activeItem, setActiveItem] = useState(null);
  const [view, setView] = useState("grid"); // grid | list

  // Init
  useEffect(() => {
    (async () => {
      try {
        const id = await findOrCreateDatabase();
        setDbId(id);
        const raw = await fetchItems(id);
        setItems(raw.map(parseItem));
      } catch (e) {
        setError("Ошибка подключения к Notion: " + e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const reload = useCallback(async (f = filters) => {
    if (!dbId) return;
    setLoading(true);
    try {
      const raw = await fetchItems(dbId, f);
      setItems(raw.map(parseItem));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [dbId, filters]);

  const handleFilter = (key, val) => {
    const nf = { ...filters, [key]: val };
    setFilters(nf);
    reload(nf);
  };

  const handleSave = async () => {
    if (!formData.title.trim()) return;
    setSaving(true);
    try {
      const tags = formData.tags.split(",").map(t => t.trim()).filter(Boolean);
      await createItem(dbId, { ...formData, tags });
      setShowForm(false);
      setFormData({ title: "", type: "Статья", source: "Интернет", status: "Новое", url: "", notes: "", tags: "" });
      await reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  const handleStatusCycle = async (item) => {
    const next = STATUS_NEXT[item.status];
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: next } : i));
    try {
      await updateStatus(item.id, next);
    } catch (e) {
      setError(e.message);
      reload();
    }
  };

  const handleDelete = async (id) => {
    setItems(prev => prev.filter(i => i.id !== id));
    setActiveItem(null);
    try {
      await deleteItem(id);
    } catch (e) {
      setError(e.message);
    }
  };

  const filtered = items.filter(i =>
    !filters.search || i.title.toLowerCase().includes(filters.search.toLowerCase()) ||
    i.notes.toLowerCase().includes(filters.search.toLowerCase())
  );

  const stats = {
    total: items.length,
    new: items.filter(i => i.status === "Новое").length,
    learning: items.filter(i => i.status === "Изучаю").length,
    done: items.filter(i => i.status === "Изучено").length,
  };
  const progress = stats.total ? Math.round((stats.done / stats.total) * 100) : 0;

  return (
    <div style={{ minHeight: "100vh", background: "#0f1117", color: "#e8eaf0", fontFamily: "'Golos Text', 'Segoe UI', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Golos+Text:wght@400;500;600;700&family=Unbounded:wght@600;700&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        ::-webkit-scrollbar { width: 6px; } ::-webkit-scrollbar-track { background: #1a1d27; } ::-webkit-scrollbar-thumb { background: #2e3347; border-radius: 3px; }
        .card { background: #171a24; border: 1px solid #232840; border-radius: 12px; transition: all .2s; cursor: pointer; }
        .card:hover { border-color: #3b4fd8; transform: translateY(-2px); box-shadow: 0 8px 32px rgba(59,79,216,.15); }
        .btn { border: none; cursor: pointer; border-radius: 8px; font-family: inherit; font-weight: 600; transition: all .15s; }
        .btn:hover { filter: brightness(1.15); }
        .pill { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
        .input { background: #1e2130; border: 1px solid #2e3347; border-radius: 8px; color: #e8eaf0; font-family: inherit; font-size: 14px; padding: 10px 14px; width: 100%; outline: none; transition: border .15s; }
        .input:focus { border-color: #3b4fd8; }
        .select { appearance: none; cursor: pointer; }
        .overlay { position: fixed; inset: 0; background: rgba(0,0,0,.7); backdrop-filter: blur(4px); z-index: 100; display: flex; align-items: center; justify-content: center; padding: 16px; }
        .modal { background: #171a24; border: 1px solid #2e3347; border-radius: 16px; padding: 28px; width: 100%; max-width: 520px; max-height: 90vh; overflow-y: auto; }
        .flt-btn { background: #1e2130; border: 1px solid #2e3347; color: #9aa0b8; font-size: 13px; font-weight: 500; padding: 6px 14px; border-radius: 20px; cursor: pointer; transition: all .15s; font-family: inherit; }
        .flt-btn.active { background: #3b4fd8; border-color: #3b4fd8; color: #fff; }
        @keyframes fadeIn { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        .fadein { animation: fadeIn .25s ease; }
      `}</style>

      {/* Header */}
      <div style={{ background: "#13161f", borderBottom: "1px solid #1e2336", padding: "0 20px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", alignItems: "center", justifyContent: "space-between", height: 64 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{ width: 36, height: 36, background: "linear-gradient(135deg,#3b4fd8,#6c63ff)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>🛡</div>
            <div>
              <div style={{ fontFamily: "'Unbounded', sans-serif", fontSize: 15, fontWeight: 700, letterSpacing: "-0.3px" }}>МОПБ Хаб</div>
              <div style={{ fontSize: 11, color: "#6b7280" }}>База знаний · Notion</div>
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button className="btn" onClick={() => setView(v => v === "grid" ? "list" : "grid")}
              style={{ background: "#1e2130", color: "#9aa0b8", padding: "8px 14px", fontSize: 13 }}>
              {view === "grid" ? "📋 Список" : "⊞ Сетка"}
            </button>
            <button className="btn" onClick={() => setShowForm(true)}
              style={{ background: "linear-gradient(135deg,#3b4fd8,#6c63ff)", color: "#fff", padding: "8px 18px", fontSize: 14 }}>
              + Добавить
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "24px 20px" }}>

        {/* Stats */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginBottom: 24 }}>
          {[
            { label: "Всего материалов", val: stats.total, icon: "📚", color: "#3b4fd8" },
            { label: "Новые", val: stats.new, icon: "🔵", color: "#6b7280" },
            { label: "Изучаю", val: stats.learning, icon: "🟡", color: "#d97706" },
            { label: "Изучено", val: stats.done, icon: "🟢", color: "#16a34a" },
          ].map(s => (
            <div key={s.label} className="card fadein" style={{ padding: "16px 18px" }}>
              <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 6 }}>{s.label}</div>
              <div style={{ fontSize: 26, fontFamily: "'Unbounded',sans-serif", fontWeight: 700, color: s.color }}>{s.val}</div>
            </div>
          ))}
        </div>

        {/* Progress bar */}
        {stats.total > 0 && (
          <div style={{ background: "#171a24", border: "1px solid #232840", borderRadius: 12, padding: "14px 18px", marginBottom: 24 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13, color: "#9aa0b8", marginBottom: 8 }}>
              <span>Прогресс изучения</span>
              <span style={{ color: "#16a34a", fontWeight: 700 }}>{progress}%</span>
            </div>
            <div style={{ background: "#1e2130", borderRadius: 8, height: 8, overflow: "hidden" }}>
              <div style={{ width: `${progress}%`, height: "100%", background: "linear-gradient(90deg,#3b4fd8,#16a34a)", borderRadius: 8, transition: "width .5s ease" }} />
            </div>
          </div>
        )}

        {/* Filters */}
        <div style={{ background: "#171a24", border: "1px solid #232840", borderRadius: 12, padding: "14px 18px", marginBottom: 20 }}>
          <input className="input" placeholder="🔍  Поиск по названию или заметке..."
            value={filters.search} onChange={e => setFilters(f => ({ ...f, search: e.target.value }))}
            style={{ marginBottom: 14 }} />
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center", minWidth: 52 }}>Статус:</span>
            {STATUSES.map(s => (
              <button key={s} className={`flt-btn${filters.status === s ? " active" : ""}`}
                onClick={() => handleFilter("status", s)}>{s}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center", minWidth: 52 }}>Тип:</span>
            {TYPES.map(s => (
              <button key={s} className={`flt-btn${filters.type === s ? " active" : ""}`}
                onClick={() => handleFilter("type", s)}>{s}</button>
            ))}
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <span style={{ fontSize: 12, color: "#6b7280", alignSelf: "center", minWidth: 52 }}>Источник:</span>
            {SOURCES.map(s => (
              <button key={s} className={`flt-btn${filters.source === s ? " active" : ""}`}
                onClick={() => handleFilter("source", s)}>{s}</button>
            ))}
          </div>
        </div>

        {/* Error */}
        {error && (
          <div style={{ background: "#2a1515", border: "1px solid #7f1d1d", borderRadius: 10, padding: "12px 16px", marginBottom: 16, fontSize: 13, color: "#fca5a5", display: "flex", justifyContent: "space-between" }}>
            <span>⚠️ {error}</span>
            <button onClick={() => setError(null)} style={{ background: "none", border: "none", color: "#fca5a5", cursor: "pointer" }}>✕</button>
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
            <div>Загрузка из Notion...</div>
          </div>
        )}

        {/* Items */}
        {!loading && filtered.length === 0 && (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#6b7280" }}>
            <div style={{ fontSize: 48, marginBottom: 12 }}>📭</div>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Материалов пока нет</div>
            <div style={{ fontSize: 13 }}>Нажмите «+ Добавить» чтобы добавить первый материал</div>
          </div>
        )}

        {!loading && filtered.length > 0 && view === "grid" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
            {filtered.map(item => (
              <div key={item.id} className="card fadein" onClick={() => setActiveItem(item)} style={{ padding: "18px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <span style={{ fontSize: 22 }}>{TYPE_ICONS[item.type] || "📄"}</span>
                  <span className="pill" style={{ background: STATUS_COLORS[item.status] + "22", color: STATUS_COLORS[item.status] }}>
                    {item.status}
                  </span>
                </div>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 6, lineHeight: 1.4 }}>{item.title}</div>
                {item.notes && <div style={{ fontSize: 12, color: "#6b7280", marginBottom: 10, lineHeight: 1.5, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{item.notes}</div>}
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: "auto" }}>
                  {item.source && <span className="pill" style={{ background: "#1e2130", color: "#9aa0b8" }}>{SOURCE_ICONS[item.source]} {item.source}</span>}
                  {item.tags.slice(0, 2).map(t => <span key={t} className="pill" style={{ background: "#1e2338", color: "#818cf8" }}>#{t}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}

        {!loading && filtered.length > 0 && view === "list" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(item => (
              <div key={item.id} className="card fadein" onClick={() => setActiveItem(item)}
                style={{ padding: "14px 18px", display: "flex", alignItems: "center", gap: 14 }}>
                <span style={{ fontSize: 20, flexShrink: 0 }}>{TYPE_ICONS[item.type] || "📄"}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</div>
                  {item.notes && <div style={{ fontSize: 12, color: "#6b7280", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{item.notes}</div>}
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0 }}>
                  {item.source && <span className="pill" style={{ background: "#1e2130", color: "#9aa0b8", fontSize: 11 }}>{item.source}</span>}
                  <span className="pill" style={{ background: STATUS_COLORS[item.status] + "22", color: STATUS_COLORS[item.status], fontSize: 11 }}>{item.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Form Modal */}
      {showForm && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setShowForm(false)}>
          <div className="modal fadein">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 22 }}>
              <div style={{ fontFamily: "'Unbounded',sans-serif", fontSize: 16, fontWeight: 700 }}>Новый материал</div>
              <button onClick={() => setShowForm(false)} style={{ background: "none", border: "none", color: "#6b7280", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Название *</label>
                <input className="input" placeholder="Название материала" value={formData.title}
                  onChange={e => setFormData(f => ({ ...f, title: e.target.value }))} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                <div>
                  <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Тип</label>
                  <select className="input select" value={formData.type} onChange={e => setFormData(f => ({ ...f, type: e.target.value }))}>
                    {TYPES.slice(1).map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Источник</label>
                  <select className="input select" value={formData.source} onChange={e => setFormData(f => ({ ...f, source: e.target.value }))}>
                    {SOURCES.slice(1).map(s => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Ссылка (URL)</label>
                <input className="input" placeholder="https://..." value={formData.url}
                  onChange={e => setFormData(f => ({ ...f, url: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Теги (через запятую)</label>
                <input className="input" placeholder="пожарная безопасность, ГОСТ, охрана труда" value={formData.tags}
                  onChange={e => setFormData(f => ({ ...f, tags: e.target.value }))} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Заметки</label>
                <textarea className="input" rows={3} placeholder="Ключевые мысли, выводы..." value={formData.notes}
                  onChange={e => setFormData(f => ({ ...f, notes: e.target.value }))} style={{ resize: "vertical" }} />
              </div>
              <div>
                <label style={{ fontSize: 12, color: "#6b7280", marginBottom: 6, display: "block" }}>Статус</label>
                <select className="input select" value={formData.status} onChange={e => setFormData(f => ({ ...f, status: e.target.value }))}>
                  {STATUSES.slice(1).map(s => <option key={s}>{s}</option>)}
                </select>
              </div>
              <button className="btn" onClick={handleSave} disabled={saving || !formData.title.trim()}
                style={{ background: "linear-gradient(135deg,#3b4fd8,#6c63ff)", color: "#fff", padding: "12px", fontSize: 15, opacity: saving ? .7 : 1 }}>
                {saving ? "Сохранение..." : "Сохранить в Notion"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Item Detail Modal */}
      {activeItem && (
        <div className="overlay" onClick={e => e.target === e.currentTarget && setActiveItem(null)}>
          <div className="modal fadein">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
              <div style={{ fontSize: 28 }}>{TYPE_ICONS[activeItem.type] || "📄"}</div>
              <button onClick={() => setActiveItem(null)} style={{ background: "none", border: "none", color: "#6b7280", fontSize: 20, cursor: "pointer" }}>✕</button>
            </div>
            <div style={{ fontFamily: "'Unbounded',sans-serif", fontSize: 16, fontWeight: 700, marginBottom: 12, lineHeight: 1.4 }}>{activeItem.title}</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16 }}>
              <span className="pill" style={{ background: STATUS_COLORS[activeItem.status] + "22", color: STATUS_COLORS[activeItem.status] }}>{activeItem.status}</span>
              {activeItem.type && <span className="pill" style={{ background: "#1e2130", color: "#9aa0b8" }}>{TYPE_ICONS[activeItem.type]} {activeItem.type}</span>}
              {activeItem.source && <span className="pill" style={{ background: "#1e2130", color: "#9aa0b8" }}>{SOURCE_ICONS[activeItem.source]} {activeItem.source}</span>}
            </div>
            {activeItem.notes && (
              <div style={{ background: "#1e2130", borderRadius: 10, padding: "14px", marginBottom: 16, fontSize: 14, lineHeight: 1.6, color: "#c8cce0" }}>
                {activeItem.notes}
              </div>
            )}
            {activeItem.tags.length > 0 && (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
                {activeItem.tags.map(t => <span key={t} className="pill" style={{ background: "#1e2338", color: "#818cf8" }}>#{t}</span>)}
              </div>
            )}
            {activeItem.url && (
              <a href={activeItem.url} target="_blank" rel="noreferrer"
                style={{ display: "block", color: "#818cf8", fontSize: 13, marginBottom: 16, wordBreak: "break-all" }}>
                🔗 {activeItem.url}
              </a>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
              <button className="btn" onClick={() => { handleStatusCycle(activeItem); setActiveItem(a => ({ ...a, status: STATUS_NEXT[a.status] })); }}
                style={{ flex: 1, background: "#1e2130", color: "#e8eaf0", padding: "10px", fontSize: 13 }}>
                ↻ Статус: {STATUS_NEXT[activeItem.status]}
              </button>
              <button className="btn" onClick={() => handleDelete(activeItem.id)}
                style={{ background: "#2a1515", color: "#fca5a5", padding: "10px 16px", fontSize: 13 }}>
                🗑
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
