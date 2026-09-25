/**
 * Virtual Agent — module entry hooks.
 * Socket handling lives in agent-app.js (single canonical listener).
 */

const DEFAULT_MAP_PATH = "modules/VirtualAgent/assets/night-city-map-red-final-v2.png";

/**
 * 1.1.0 one-time migration. The module id changed from "AgentDevice" to
 * "VirtualAgent"; Foundry keys world settings + actor/user/message flags by id,
 * so this carries every piece of legacy data into the new namespace on first
 * load. GM-only, idempotent, rewrites module-folder asset paths
 * (rewriting old module-folder paths to the VirtualAgent folder). Old data is never deleted.
 */
async function migrateFromAgentDevice() {
    const OLD = "AgentDevice", NEW = "VirtualAgent";
    if (!game.user.isGM) return;
    if (game.users.activeGM && game.user !== game.users.activeGM) return; // one GM only
    if (game.settings.get(NEW, "migratedFromAgentDevice")) return;

    const rw = (v) => (typeof v === "string") ? v.split(`modules/${OLD}/`).join(`modules/${NEW}/`) : v;
    const deep = (o) => {
        if (typeof o === "string") return rw(o);
        if (Array.isArray(o)) return o.map(deep);
        if (o && typeof o === "object") { const r = {}; for (const k in o) r[k] = deep(o[k]); return r; }
        return o;
    };
    const c = { settings: 0, users: 0, actors: 0, messages: 0 };
    try {
        ui.notifications?.info?.("Virtual Agent: migrating your saved data from the previous version…");

        // 1) World settings — raw Setting-document copy AgentDevice.* -> VirtualAgent.*
        //    (copies the exact stored value so serialization is preserved; rewrites asset paths).
        const ws = game.settings.storage.get("world");
        for (const s of [...ws].filter(x => typeof x.key === "string" && x.key.startsWith(`${OLD}.`))) {
            try {
                const newKey = `${NEW}.${s.key.slice(OLD.length + 1)}`;
                const value = rw(s.value);
                const existing = ws.find(x => x.key === newKey);
                if (existing) await existing.update({ value });
                else await Setting.create({ key: newKey, value });
                c.settings++;
            } catch (e) { console.warn(`[Virtual Agent] setting ${s.key} migrate failed:`, e); }
        }

        // 2) User flags — wallets, contacts, unreads, idOverrides, fixerRank, app-locks…
        const uUpd = [];
        for (const u of game.users) {
            const f = u.flags?.[OLD];
            if (f && Object.keys(f).length) uUpd.push({ _id: u.id, [`flags.${NEW}`]: deep(foundry.utils.deepClone(f)) });
        }
        if (uUpd.length) { await User.updateDocuments(uUpd); c.users = uUpd.length; }

        // 3) Actor flags — housing + any per-actor state on linked characters.
        const aUpd = [];
        for (const a of game.actors) {
            const f = a.flags?.[OLD];
            if (f && Object.keys(f).length) aUpd.push({ _id: a.id, [`flags.${NEW}`]: deep(foundry.utils.deepClone(f)) });
        }
        if (aUpd.length) { await Actor.updateDocuments(aUpd); c.actors = aUpd.length; }

        // 4) ChatMessage flags — the entire Agent chat history (threads, NPC voices, avatars). Batched.
        const mUpd = [];
        for (const m of game.messages) {
            const f = m.flags?.[OLD];
            if (f && Object.keys(f).length) mUpd.push({ _id: m.id, [`flags.${NEW}`]: deep(foundry.utils.deepClone(f)) });
        }
        for (let i = 0; i < mUpd.length; i += 200) await ChatMessage.updateDocuments(mUpd.slice(i, i + 200));
        c.messages = mUpd.length;

        await game.settings.set(NEW, "migratedFromAgentDevice", true);
        console.log("[Virtual Agent] Migration from AgentDevice complete:", c);
        ui.notifications?.info?.(`Virtual Agent: migration complete — ${c.settings} settings, ${c.users} player profiles, ${c.actors} characters, ${c.messages} chat messages carried over.`);
    } catch (e) {
        console.error("[Virtual Agent] Migration failed:", e);
        ui.notifications?.error?.("Virtual Agent: data migration hit a snag — see the console (F12). Your old AgentDevice data is untouched; reloading retries.");
    }
}

Hooks.once('init', function () {
    console.log('Virtual Agent | Initializing...');

    // --- World settings (GM-only, sync to all clients automatically) ---

    // 5.6.0: COMBAT app gamification level. 'full' = damage pops + banners,
    // 'numbers-only' = data only (no animations), 'off' = minimal feedback.
    game.settings.register("VirtualAgent", "combatGamification", {
        name: "COMBAT App Gamification",
        hint: "How much animation/feedback during COMBAT app rolls. 'full' is the FFXII-style experience.",
        scope: "world",
        config: true,
        type: String,
        choices: { "full": "Full (damage pops + banners)", "numbers-only": "Numbers only (no animations)", "off": "Off (minimal)" },
        default: "full"
    });

    // 1.2.0 — per-device Agent UI scale. Set via the corner-drag grip on the Agent itself,
    // NOT this menu (config:false). Client scope = per browser/device, so a player on a small
    // or high-DPI screen (e.g. a 13" MacBook) can size the Agent up without affecting anyone else.
    game.settings.register("VirtualAgent", "agentScale", {
        scope: "client",
        config: false,
        type: Number,
        default: 1
    });

    // 1.3.0 — GM toggle: can players see NPC HP / armor SP in the COMBAT app? Default ON keeps
    // the current behavior; turn it OFF so PCs can't read enemy vitals (immersion). The GM always
    // sees them. World scope + restricted = one table-wide switch only the GM can flip; the
    // onChange re-renders every open Agent so players see the change immediately.
    // 1.5.0 — reactive bullet-dodging. When a player-owned target is attacked in the COMBAT app,
    // prompt THAT player (or the GM for an NPC) to roll their own Evasion before damage is applied;
    // their roll becomes the DV. Default ON. Turn off to resolve attacks straight against the range DV.
    game.settings.register("VirtualAgent", "reactiveDodgePrompt", {
        name: "Reactive Dodge Prompts",
        hint: "When a target is attacked in the COMBAT app, prompt its owner to roll their own Evasion (Dodge) before damage applies — no more undoing HP/armor after a manual dodge. Ranged dodges need REF 8+. Turn off to resolve immediately against the range DV.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: true
    });

    game.settings.register("VirtualAgent", "showNpcVitalsToPlayers", {
        name: "Show NPC HP/SP to Players",
        hint: "When on, players see NPCs' HP and armor SP in the COMBAT app (target lists + the active-combatant status card). Turn off to hide enemy vitals from players — the GM always sees them.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: true,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "uiSkin", {
        name: "UI Skin",
        hint: "Visual theme applied to all players' Agent devices. RED is the default Cyberpunk RED aesthetic; 2077 is a yellow/holographic variant.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        choices: { "red": "Cyberpunk RED", "2077": "Cyberpunk 2077" },
        default: "red",
        onChange: () => {
            try { game.socket.emit("module.VirtualAgent", { action: "refreshSkin" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "mapImagePath", {
        name: "Sat Map Image Path",
        hint: "Managed via the Agent's Sys Admin -> Visual section (with Browse). This entry is hidden to keep the FilePicker-equipped UI as the single source of truth.",
        scope: "world",
        // Patch5.5.20: hidden from Foundry's Configure Game Settings menu — that UI
        // is text-only (no FilePicker), and GMs typing absolute Windows paths in
        // there got broken results (Praise Jaheebus issue). The agent's Sys Admin
        // Visual section has the Browse button + warning toast. Single source of truth.
        config: false,
        restricted: true,
        type: String,
        default: DEFAULT_MAP_PATH,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "partyGroupChatName", {
        name: "Party / Group Chat Name",
        hint: "Display name for the permanent group chat channel visible to all players.",
        scope: "world",
        config: false,
        type: String,
        default: "Party / Group Net",
        onChange: () => {
            try { game.socket.emit("module.VirtualAgent", { action: "refreshOnlineStatus" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "socialFeedArticles", {
        name: "Social Feed Articles (JSON)",
        hint: 'Optional JSON array of social-feed entries. Each entry: { "category": "Trending in AGZ", "text": "..." }. Leave blank to use defaults.',
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    // NuNu packaging: role and standing per contact id, so the Contacts app needs no list of its own.
    game.settings.register("VirtualAgent", "textNotices", {
        name: "Announce incoming texts",
        hint: "Pops a notice in the corner naming the sender and the first line of their message. Click it to open the thread.",
        scope: "client", config: true, type: Boolean, default: true,
    });
    game.settings.register("VirtualAgent", "textNoticeVolume", {
        name: "Text notice volume",
        hint: "Volume of the chime when a text arrives. Zero is silent.",
        scope: "client", config: true, type: Number, default: 0.4,
        range: { min: 0, max: 1, step: 0.1 },
    });
    game.settings.register("VirtualAgent", "contactMeta", {
        name: "Contact roles and standing (JSON)",
        hint: "Set from the Contacts app. Keyed by contact id.",
        scope: "world", config: false, type: String, default: "{}",
        onChange: () => { const a = globalThis.AgentDeviceApp?.ui; if (a?.rendered) a.render(true); },
    });
    game.settings.register("VirtualAgent", "npcReputations", {
        name: "NPC Reputations (JSON)",
        hint: 'JSON array of NPC reputation entries. Managed via the FIXERS app in-device.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            try { game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "auctionListings", {
        name: "Auction Listings (JSON)",
        hint: 'JSON array of active auction listings. Managed via the BLACK MKT app in-device.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            try { game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "customStoreItems", {
        name: "Custom NuNu Mart Items (JSON)",
        hint: 'JSON array of custom store items. Each: { name, category, price, img (optional), description (optional) }. Managed via Sys Admin.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            // Invalidate store cache so items refresh
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "inGameClock", {
        name: "In-Game Clock",
        hint: 'Manual in-game time (HH:MM format). Overridden by Simple Calendar if installed. Set via Sys Admin.',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            try { game.socket.emit("module.VirtualAgent", { action: "clockUpdate" }); } catch (e) {}
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "customStorePacks", {
        name: "Custom Compendium Packs for NuNu Mart",
        hint: 'Comma-separated compendium pack IDs to include in NuNu Mart (e.g., "world.my-gear,world.my-weapons").',
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    // Patch3 (Ryouhi request): optional Sequencer/JB2A/Tagger-powered
    // "holophone calling" VFX on the controlled token while the Agent is open.
    // Off by default — only useful at tables that have those modules installed.
    game.settings.register("VirtualAgent", "enableCallAnimation", {
        name: "Holophone Call Animation (Sequencer)",
        hint: "Plays a 'calling' VFX over the controlled token while the Agent device is open. Requires Sequencer + Tagger + JB2A. No-op if those modules aren't installed.",
        scope: "world",
        config: true,
        restricted: true,
        type: Boolean,
        default: true
    });

    // Patch3.2 (CommanderCrunch69-class GM control request): NuNu Mart gates.
    // These are read in agent-app.js getData / catalog assembly and the cart
    // checkout path so even a cached catalog can't sneak past them.
    game.settings.register("VirtualAgent", "storeMaxPrice", {
        name: "NuNu Mart — Max Item Price (eb)",
        hint: "Hide any items priced strictly above this value. 0 = no cap. Use this to enforce 'nothing over 500eb tonight' rules.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 0,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    // Patch4.7 (Gotto): Night City style trend. GM sets a short label that
    // appears on every player's Style screen, plus an optional flavor blurb.
    game.settings.register("VirtualAgent", "styleTrend", {
        name: "Style — Current Trend Label",
        hint: "Short label shown on every player's Style screen (e.g. 'Asia Pop', 'Nomad Leathers', 'Chromatic Glitch'). Empty = no trend banner.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });
    game.settings.register("VirtualAgent", "styleTrendDesc", {
        name: "Style — Current Trend Flavor",
        hint: "Optional sentence under the trend label (e.g. 'Corpo execs in monochrome neon').",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    // Patch4.7 (Gotto): fixer-rank availability gates. Items priced strictly
    // above `storeFixerGatePrice` are hidden from players whose `fixerRank`
    // user-flag is below `storeFixerGateRank`. Both at 0 = gate disabled.
    game.settings.register("VirtualAgent", "storeFixerGatePrice", {
        name: "NuNu Mart — Fixer Rank Gate · Price Threshold (eb)",
        hint: "Items priced strictly above this value require a minimum Fixer rank to appear. 0 = gate disabled.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 0,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "storeFixerGateRank", {
        name: "NuNu Mart — Fixer Rank Gate · Minimum Rank",
        hint: "Minimum Fixer rank required for a player to see items above the price threshold. Each player's rank is set per-user in Sys Admin.",
        scope: "world",
        config: true,
        restricted: true,
        type: Number,
        default: 0,
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    // ════════════════════════════════════════════════════════════════════════
    // Patch5.5 — Black Chrome / All About Agents app data stores.
    // All world-scope JSON-encoded arrays of objects. GM-authored content
    // (rap sheets, city listings, dating profiles, map indicators, the
    // current night market). Players read; GM writes via Sys Admin panels.
    // ════════════════════════════════════════════════════════════════════════

    game.settings.register("VirtualAgent", "ncpdRapSheets", {
        name: "AGPD Crime Database — Rap Sheets (JSON)",
        hint: "GM-authored crime records. Managed via the AGPD DB Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "cityDirectoryEntries", {
        name: "Ziggurat City Database — Listings (JSON)",
        hint: "GM-authored city directory. Managed via the Ziggurat Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "gardenProfiles", {
        name: "The Garden — Dating Profiles (JSON)",
        hint: "GM-authored dating profiles. Managed via the Garden Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "mapIndicators", {
        name: "Sat Map — Indicators / Pins (JSON)",
        hint: "GM-placed map indicators. Managed via the Map Indicators Sys Admin panel.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "[]",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "nightMarketActive", {
        name: "NuNu Mart — Active Night Market (JSON)",
        hint: "Curated current Night Market — { name, openedAt, items:[{uuid, name, price, flavor, img}] }. GM authors via Sys Admin.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "storeSourceFilter", {
        name: "NuNu Mart — Source Filter",
        hint: "Restrict which items appear: 'all' includes both compendium/core packs and your custom items; 'core' shows only compendium-sourced items; 'custom' shows only items you added via Sys Admin.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        choices: { "all": "All (core + custom)", "core": "Core/compendium only", "custom": "Custom items only" },
        default: "all",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "storeLockedCategories", {
        name: "NuNu Mart — Locked Categories",
        hint: "Comma-separated list of category names that should be hidden from the shop entirely. Example: \"Cyberware, Drugs\". Useful when a vendor only stocks certain stuff.",
        scope: "world",
        config: true,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    game.settings.register("VirtualAgent", "storeBlacklistIds", {
        name: "NuNu Mart — Blacklisted Item UUIDs / Names",
        hint: "Comma- or newline-separated list of item UUIDs or names to hide from the shop. Use Sys Admin's blacklist UI to manage this list interactively.",
        scope: "world",
        config: false,
        restricted: true,
        type: String,
        default: "",
        onChange: () => {
            const ui = globalThis.AgentDeviceApp?.ui;
            if (ui) { ui._storeCatalog = null; ui._storeLoading = null; }
            if (ui?.rendered) ui.render(true);
        }
    });

    // 1.1.0: idempotency flag for the one-time AgentDevice -> VirtualAgent migration.
    game.settings.register("VirtualAgent", "migratedFromAgentDevice", {
        scope: "world", config: false, type: Boolean, default: false
    });
});

Hooks.once('ready', async function () {
    console.log('Virtual Agent | CitiNet wired.');

    // 1.1.0: the module id changed (AgentDevice -> VirtualAgent). Carry legacy data over on first load.
    try { await migrateFromAgentDevice(); } catch (e) { console.error('[Virtual Agent] migration call failed:', e); }

    // Patch4.7.1 (urgent): Simple Calendar integration was firing
    // `simple-calendar-date-time-change` every in-game second while the
    // game was unpaused — each fire ran a full Agent re-render which
    // unbound click handlers faster than users could click them. Route
    // through the throttled render helper (4 renders/sec ceiling) so the
    // clock still updates promptly but clicks stay responsive.
    // 1.7.2 — the Agent clock only shows HH:MM, but SC fires this hook every in-game
    // SECOND. Re-rendering the whole device (even throttled to ~4/sec) for a clock that
    // only changes once a minute is the "constant refresh" players report — and under a
    // busy session it tips back into unbinding click handlers. Only queue a render when
    // the displayed minute actually changes; ~59 of every 60 ticks now do nothing.
    let _lastAgentClockMinute = null;
    Hooks.on("simple-calendar-date-time-change", () => {
        let hhmm = null;
        try {
            const dt = globalThis.SimpleCalendar?.api?.currentDateTime?.();
            if (dt) hhmm = `${String(dt.hour).padStart(2, '0')}:${String(dt.minute).padStart(2, '0')}`;
        } catch (e) {}
        // Only skip when we could read the time AND it's the same minute as the last render.
        // If the time can't be read (hhmm null), fall through to the throttled render as before.
        if (hhmm !== null && hhmm === _lastAgentClockMinute) return;
        _lastAgentClockMinute = hhmm;
        _queueAgentRender();
    });

    // Keep group-chat participants accurate when players connect/disconnect.
    // Throttled for the same reason — bulk reconnect bursts can chain hooks.
    Hooks.on("userConnected", () => {
        const ui = globalThis.AgentDeviceApp?.ui;
        if (ui?.rendered && ui.currentView === 'chat-thread' && ui.activeContactId === 'party_group_chat') {
            _queueAgentRender();
        }
    });

    // 5.7.1: combat turn change → reset per-turn state so action pips refill,
    // defend flag clears, and the upper viewport reflects the new active combatant.
    // Fires when GM advances turn from the Combat Tracker, not just from END TURN.
    Hooks.on("updateCombat", (combat, changed) => {
        if (!("turn" in changed || "round" in changed)) return;
        const ui = globalThis.AgentDeviceApp?.ui;
        if (!ui) return;
        ui._combatBudget = { move: 'available', action: 'available', bonus: 'available' };
        ui._combatMenu = 'main';
        ui._attackPhase = 'weapon';
        ui._attackWeapon = null;
        ui._attackTarget = null;
        ui._attackRoll = null;
        ui._attackDamage = null;
        ui._attackRollPrep = null;  // 5.8.32: prep dialog used to survive turn changes
        ui._movePending = null;     // 5.8.32: ditto for the move picker
        // 5.8.28: if new active combatant is Mortally Wounded, GM-side auto-prompts Death Save (CPR pg 186)
        try {
            if (game.user.isGM) {
                const _act = combat?.combatant?.actor;
                if (_act) {
                    const _hpV = Number(_act.system?.derivedStats?.hp?.value ?? _act.system?.hp?.value ?? 0);
                    // 1.5.2 — don't roll a Death Save for an already-dead combatant (CPR pg 187: one fail = dead).
                    const _isDead = !!_act.getFlag?.('VirtualAgent', 'agentDead') || !!combat?.combatant?.isDefeated;
                    if (_hpV >= 1) {
                        // revived above 0 HP — clear the death marker so a future Mortally-Wounded turn saves again
                        if (_act.getFlag?.('VirtualAgent', 'agentDead')) { try { _act.unsetFlag?.('VirtualAgent', 'agentDead'); } catch (e) {} }
                    } else if (!_isDead && typeof ui._rollDeathSave === 'function') {
                        ui._rollDeathSave({ actor: _act });
                    }
                }
            }
        } catch (e) { console.warn('[AgentDevice 5.8.28] death save trigger failed:', e); }
        if (ui.rendered && ui.currentView === 'combat') ui.render(true);
    });

    // --- MIGRATION: ensure new apps are unlocked for existing users ---
    // When new apps are added, users who already have an unlockedApps flag
    // won't pick up the new defaults. This patches them in automatically.
    const REQUIRED_APPS = ['style', 'rep', 'auction'];
    const migrateUnlocked = async (flagOwner) => {
        const existing = flagOwner.getFlag("VirtualAgent", "unlockedApps");
        if (!existing || !Array.isArray(existing)) return; // no flag = will use defaults
        // NuNu packaging: once the GM has set this owner's app list (the 5.6 marker), it is authoritative.
        // Without this, STYLE / FIXERS / BLACK MKT were re-added on every load after being switched off.
        if (flagOwner.getFlag("VirtualAgent", "unlockedAppsMigrated5_6")) return;
        const missing = REQUIRED_APPS.filter(a => !existing.includes(a));
        if (missing.length > 0) {
            console.log(`Virtual Agent | Migration: adding [${missing.join(',')}] to ${flagOwner.name || flagOwner.id}`);
            await flagOwner.setFlag("VirtualAgent", "unlockedApps", [...existing, ...missing]);
        }
    };

    // GM migrates all users + all actors that have the flag
    if (game.user.isGM) {
        for (const user of game.users) {
            await migrateUnlocked(user);
        }
        for (const actor of game.actors) {
            if (actor.getFlag("VirtualAgent", "unlockedApps")) {
                await migrateUnlocked(actor);
            }
        }
    } else {
        // Players migrate only themselves
        await migrateUnlocked(game.user);
    }
});

/* ------------------------------------------------------------------ *
 *  NuNu packaging: texts that arrived while you were logged out.
 *
 *  `createChatMessage` only fires on connected clients, so a message sent
 *  while somebody was away never reached their unread count and they came
 *  back to a silent phone.
 *
 *  The mark is the id of the last Agent message this client accounted for,
 *  not a timestamp. Message timestamps are stamped by whichever machine
 *  created them, so a GM whose clock runs fast would make every text look
 *  newer than the player's own mark and get counted twice. Document order
 *  is the same on every client, so walking from the marked message forward
 *  has no clock in it at all.
 * ------------------------------------------------------------------ */

/** Does this Agent message belong in my unread count, and under which thread? */
function _agentUnreadThread(m) {
    const f = m.flags?.VirtualAgent;
    if (!f?.isAgentMessage) return null;
    if (m.author?.id === game.user.id) return null;

    const w = Array.isArray(m.whisper) ? m.whisper : [];
    // A GM watches everything, exactly as the live hook below lets them.
    if (w.length && !w.includes(game.user.id) && !game.user.isGM) return null;

    let threadId = f.threadId;
    if (!threadId) return null;
    if (!String(threadId).startsWith("npc_") && !String(threadId).startsWith("pcgroup_")
        && threadId !== "party_group_chat" && w.length && w.includes(game.user.id)) {
        // A one-to-one lands under whoever sent it. Without a sender there is no
        // row to put it on, so it is not counted rather than counted invisibly.
        if (!m.author?.id) return null;
        threadId = m.author.id;
    }
    return threadId;
}

Hooks.once("ready", async () => {
    try {
        const mark = game.user.getFlag("VirtualAgent", "lastSeenMsgId");
        const ordered = game.messages.contents;
        const newest = [...ordered].reverse().find((m) => m.flags?.VirtualAgent?.isAgentMessage);
        const stamp = async (id) => { if (id) await game.user.setFlag("VirtualAgent", "lastSeenMsgId", id); };

        // First run on an existing world: start from now rather than counting a
        // campaign's worth of history, most of which has been read.
        if (mark === undefined) return stamp(newest?.id);

        const from = mark ? ordered.findIndex((m) => m.id === mark) : -1;
        const missed = ordered.slice(from + 1);
        if (!missed.length) return stamp(newest?.id);

        // Only threads that still exist. A count against a contact somebody deleted
        // can never be cleared, because there is no row left to open.
        const live = new Set((globalThis.AgentDeviceApp?.ui?._getContacts?.({ ignoreSearch: true }) || []).map((c) => c.id));
        const unreads = { ...(game.user.getFlag("VirtualAgent", "unreads") || {}) };
        let added = 0;

        for (const m of missed) {
            const threadId = _agentUnreadThread(m);
            if (!threadId || !live.has(threadId)) continue;
            unreads[threadId] = (unreads[threadId] || 0) + 1;
            added++;
        }

        // The count and the mark move together, so nothing is counted twice and
        // nothing is skipped if this fails halfway.
        const update = { "flags.VirtualAgent.lastSeenMsgId": newest?.id ?? mark };
        if (added) update["flags.VirtualAgent.unreads"] = unreads;
        await game.user.update(update);

        let notices = true;
        try { notices = game.settings.get("VirtualAgent", "textNotices"); } catch (e) { /* default on */ }
        if (added && notices) ui.notifications?.info?.(`Agent: ${added} message${added === 1 ? "" : "s"} while you were away.`);
    } catch (e) { console.error("VirtualAgent | offline catch-up failed:", e); }
});

// Scene-controls button (consistent name + tooltip)
Hooks.on('getSceneControlButtons', (controls) => {
    let tokenControls = controls.find(c => c.name === "token");
    if (tokenControls) {
        tokenControls.tools.push({
            name: "agent-device-app",
            title: "Open Virtual Agent",
            icon: "fas fa-mobile-alt",
            button: true,
            onClick: () => {
                if (globalThis.AgentDeviceApp && globalThis.AgentDeviceApp.ui) {
                    globalThis.AgentDeviceApp.ui.render(true);
                }
            }
        });
    }
});

// Patch4.7 (BubbleMushroom) + Patch4.7.1 (urgent unpause fix):
// The createChatMessage hook used to call app.render(true) synchronously
// for every Agent message; Simple Calendar's date-time-change hook did the
// same on every tick. With an unpaused game + SC running, that's many
// renders per second — click handlers get unbound by the next render
// before the user's click event fires (reported as "clicks unregistered
// while unpaused"). 4.7's rAF coalesce wasn't enough — 60 renders/sec
// still saturates the click budget. Switched to a leading+trailing
// throttle with a 250ms floor: render immediately on the first request in
// a quiet window, then ignore subsequent requests until 250ms has passed,
// then schedule one trailing render to catch the latest state. Caps at
// ~4 renders/sec regardless of how chatty the source is.
let _agentRenderTimer = null;
let _agentLastRenderTs = 0;
const _AGENT_RENDER_MIN_INTERVAL_MS = 250;
function _queueAgentRender() {
    const app = globalThis.AgentDeviceApp?.ui;
    if (!app?.rendered) return;
    const now = Date.now();
    const since = now - _agentLastRenderTs;
    if (since >= _AGENT_RENDER_MIN_INTERVAL_MS) {
        // Leading edge — quiet window, fire now. Clear any stale trailing
        // timer from a prior burst so we don't double-render.
        if (_agentRenderTimer) { clearTimeout(_agentRenderTimer); _agentRenderTimer = null; }
        _agentLastRenderTs = now;
        app.render(true);
        return;
    }
    // Inside the throttle window — schedule one trailing render.
    if (_agentRenderTimer) return;
    _agentRenderTimer = setTimeout(() => {
        _agentRenderTimer = null;
        _agentLastRenderTs = Date.now();
        const a = globalThis.AgentDeviceApp?.ui;
        if (a?.rendered) a.render(true);
    }, _AGENT_RENDER_MIN_INTERVAL_MS - since);
}

// Refresh the UI on new Agent messages and track unreads
Hooks.on('createChatMessage', async (message, options, userId) => {
    if (!message.flags?.VirtualAgent?.isAgentMessage) return;

    let threadId = message.flags.VirtualAgent.threadId;
    const authorId = message.author?.id;
    const isAuthor = authorId === game.user.id;

    // 5.8.43: only remap 1-to-1 DM threads (threadId = a plain user id). Group threads
    // (pcgroup_*, party_group_chat) carry a shared thread id, so remapping to the author
    // mislabels the unread onto the sender's DM row — mirror the display filter's exclusions.
    if (threadId && !threadId.startsWith("npc_") && !threadId.startsWith("pcgroup_") && threadId !== "party_group_chat" && message.whisper && message.whisper.length > 0 && message.whisper.includes(game.user.id)) {
        threadId = authorId;
    }

    // 5.5.22 (CommanderCrunch69 privacy bug): Foundry delivers ChatMessage
    // documents to every connected client, not just the whisper recipients
    // — `createChatMessage` therefore fires on uninvolved clients too.
    // Without a gate, PC C gets unread badges, auto-resurrected contacts,
    // and "Incoming from PC A" toast notifications for DMs between PC A
    // and PC B. Hard gate: bail out when this is a whispered message
    // whose whisper list excludes the current user (GMs always process
    // for monitoring; authors fall through to the existing !isAuthor
    // gate below).
    if (!isAuthor && !game.user.isGM
        && Array.isArray(message.whisper)
        && message.whisper.length > 0
        && !message.whisper.includes(game.user.id)) {
        return;
    }

    if (threadId && !isAuthor) {
        let unreads = game.user.getFlag("VirtualAgent", "unreads") || {};
        let app = globalThis.AgentDeviceApp?.ui;

        const looking = app?.rendered && app.currentView === 'chat-thread' && app.activeContactId === threadId;
        if (!looking) {
            unreads[threadId] = (unreads[threadId] || 0) + 1;
            // NuNu packaging: the unread count and the mark the next login reads from move
            // in one write. Two writes could leave the mark past a message never counted.
            await game.user.update({
                "flags.VirtualAgent.unreads": unreads,
                "flags.VirtualAgent.lastSeenMsgId": message.id,
            });
            // A text you are not already reading announces itself, with who it is from and
            // the opening words, plus a short chime.
            _agentAnnounce(message);
        } else {
            await game.user.setFlag("VirtualAgent", "lastSeenMsgId", message.id);
        }

        // Patch4.8 (player report): if the recipient deleted this NPC thread
        // and the GM later sends another message to it, the thread didn't
        // re-appear — the player had to manually re-add the contact. Now we
        // auto-resurrect: if the message is for an NPC thread (`npc_*` ids)
        // AND the receiving user doesn't have a matching customContact, push
        // one back in using the metadata embedded on the chat message.
        //
        // Patch5.0.1 (Gotto, "players read NPC messages they shouldn't"):
        // `createChatMessage` fires on EVERY client regardless of whisper
        // visibility. Foundry syncs the document to all sessions; whisper
        // only controls what's rendered in the chat log. The earlier
        // auto-resurrect was running on every client, so an NPC message
        // whispered only to GMs still materialised the contact on every
        // player's device — they then saw the thread + message even though
        // the GM never targeted them. Hard gate: only resurrect if THIS
        // user is in the whisper list (or no whisper = public, which
        // shouldn't happen for npc_* threads but covered defensively).
        try {
            if (threadId.startsWith("npc_")) {
                const hasWhisper = Array.isArray(message.whisper) && message.whisper.length > 0;
                const userIsRecipient = hasWhisper
                    ? message.whisper.includes(game.user.id)
                    : true; // public message — everyone is implicit recipient
                if (userIsRecipient && !game.user.isGM) {
                    const myContacts = game.user.getFlag("VirtualAgent", "customContacts") || [];
                    if (!myContacts.some(c => c.id === threadId || String(threadId).startsWith(`${c.id}__`))) {
                        const flags = message.flags.VirtualAgent;
                        const restored = {
                            id: threadId,
                            name: flags.overrideName || flags.targetName || "Resurrected Contact",
                            avatar: flags.overrideAvatar || "",
                            isPlayer: false,
                            targetUserIds: [game.user.id]
                        };
                        await game.user.setFlag("VirtualAgent", "customContacts", [...myContacts, restored]);
                        ui.notifications?.info?.(`Agent: "${restored.name}" reconnected to your CitiNet directory.`);
                    }
                }
            }
        } catch (e) {
            console.warn("AgentDevice | NPC thread auto-resurrect failed:", e);
        }
    }

    const app = globalThis.AgentDeviceApp?.ui;
    if (app?.rendered) {
        _queueAgentRender();
    } else if (!isAuthor) {
        const senderName = message.author?.name || "Unknown";
        const override = message.flags.VirtualAgent.overrideName;
        const target = message.flags.VirtualAgent.targetName;
        let displaySender = override || senderName;
        if (target && !override && game.user.isGM) displaySender = `${senderName} » ${target}`;
        ui.notifications.info(`Agent Alert: Incoming from ${displaySender} (CitiNet)`);
    }
});

// 1.8.4 — ROLL-VANISH WATCHDOG. Players report rolls (from the CPR character sheet, not the
// Agent) appearing on screen, vanishing, and being absent from the chat log. This module never
// deletes non-Agent messages (its only delete paths are the manual bubble delete and the GM
// npc-contact sweep, both keyed on VirtualAgent flags that sheet rolls don't carry) — so
// SOMETHING ELSE is deleting them, or a render pipeline (e.g. 3D-dice interplay) is swallowing
// them. These two console-only hooks settle it:
//   • preDeleteChatMessage fires on the client that INITIATES the deletion — the stack trace
//     names exactly which module/code asked for it.
//   • deleteChatMessage fires on EVERY client — so the affected player can confirm "the roll
//     was truly deleted" vs "it exists but didn't render" (reload would bring the latter back).
// Zero behavior change; logs only for roll-bearing or fresh (<10 min) messages.
Hooks.on('preDeleteChatMessage', (msg) => {
    try {
        const nRolls = msg.rolls?.length || 0;
        const ageMs = Date.now() - (msg.timestamp || 0);
        if (nRolls === 0 && ageMs > 10 * 60 * 1000) return;
        console.warn(`[VirtualAgent rollwatch] message being DELETED (initiated on THIS client) | id: ${msg.id} | author: ${msg.author?.name || '?'} | rolls: ${nRolls}${nRolls ? ` (total ${msg.rolls[0]?.total})` : ''} | age: ${Math.round(ageMs / 1000)}s | requested by:`, new Error().stack);
    } catch (e) {}
});
Hooks.on('deleteChatMessage', (msg, options, userId) => {
    try {
        const nRolls = msg.rolls?.length || 0;
        if (nRolls === 0) return;
        console.warn(`[VirtualAgent rollwatch] roll message DELETED | id: ${msg.id} | author: ${msg.author?.name || '?'} | total: ${msg.rolls[0]?.total} | deletion by user: ${game.users?.get?.(userId)?.name || userId}`);
    } catch (e) {}
});


/* ------------------------------------------------------------------ */
/*  NuNu packaging: the Sat Map follows a Foundry scene                 */
/*  - Foundry map pins (Notes) on that scene become Sat Map pins.       */
/*  - The active scene's spot on that map is the party blip.            */
/* ------------------------------------------------------------------ */
globalThis.VirtualAgentWorldMap = {
    scene() {
        let name = "";
        try { name = game.settings.get("VirtualAgent", "satMapScene") || ""; } catch (e) { return null; }
        return name ? (game.scenes.getName(name) ?? null) : null;
    },
    pct(wm, x, y) {
        const d = wm.dimensions;
        return { x: Math.round(((x - d.sceneX) / d.sceneWidth) * 10000) / 100, y: Math.round(((y - d.sceneY) / d.sceneHeight) * 10000) / 100 };
    },
    /** The party blip: the centre of the party marker token on the world-map scene. */
    partyPos(wm) {
        const name = (game.settings.get("VirtualAgent", "partyMarkerName") || "Party Marker").trim().toLowerCase();
        const tok = wm.tokens.find((t) => (t.name || "").trim().toLowerCase() === name);
        if (!tok) return null;
        const g = wm.grid.size;
        return this.pct(wm, tok.x + (tok.width * g) / 2, tok.y + (tok.height * g) / 2);
    },
    pinsFromNotes(wm) {
        const players = game.users.filter((u) => !u.isGM);
        return wm.notes.contents.map((n) => {
            const entry = n.entry, p = this.pct(wm, n.x, n.y);
            const visible = entry ? players.some((u) => entry.testUserPermission(u, "LIMITED")) : true;
            return { id: `note_${n.id}`, label: n.label || entry?.name || "Pin", color: "#75e0d7", icon: "fa-map-marker-alt", notes: "", labelMode: "hover", x: p.x, y: p.y, isVisible: visible, createdAt: 0 };
        });
    },
    /** GM only. Replaces the synced pins, keeps the ones placed by hand on the phone. */
    async sync() {
        if (!game.user?.isGM) return;
        const wm = this.scene(); if (!wm) return;
        let pins = [];
        try { pins = JSON.parse(game.settings.get("VirtualAgent", "mapIndicators") || "[]"); } catch (e) {}
        if (!Array.isArray(pins)) pins = [];
        const wanted = game.settings.get("VirtualAgent", "syncWorldMapPins") ? this.pinsFromNotes(wm) : [];
        const next = [...pins.filter((p) => !String(p.id).startsWith("note_")), ...wanted];
        if (JSON.stringify(pins) !== JSON.stringify(next)) await game.settings.set("VirtualAgent", "mapIndicators", JSON.stringify(next));
    }
};
Hooks.once("init", () => {
    game.settings.register("VirtualAgent", "satMapScene", {
        name: "Sat Map scene",
        hint: "Name of the Foundry scene the Sat Map picture shows. Its map pins appear on the phone, and the party marker token on it becomes the blip.",
        scope: "world", config: true, type: String, default: "",
        onChange: () => globalThis.VirtualAgentWorldMap.sync().then(() => _queueAgentRender()).catch(console.error)
    });
    game.settings.register("VirtualAgent", "syncWorldMapPins", {
        name: "Show the scene's map notes as Sat Map pins",
        hint: "Off (default): the Sat Map shows only the picture and the party blip. On: the Sat Map scene's journal pins appear too, with the same player visibility.",
        scope: "world", config: true, type: Boolean, default: false,
        onChange: () => globalThis.VirtualAgentWorldMap.sync().then(() => _queueAgentRender()).catch(console.error)
    });
    game.settings.register("VirtualAgent", "partyMarkerName", {
        name: "Party marker token",
        hint: "Name of the token on the Sat Map scene that marks where the party is. Move it and the blip follows.",
        scope: "world", config: true, type: String, default: "Party Marker",
        onChange: () => _queueAgentRender()
    });
});
Hooks.once("ready", () => { globalThis.VirtualAgentWorldMap.sync().catch(console.error); });
for (const h of ["createNote", "updateNote", "deleteNote"]) {
    Hooks.on(h, (doc) => {
        if (doc.parent?.id !== globalThis.VirtualAgentWorldMap.scene()?.id) return;
        globalThis.VirtualAgentWorldMap.sync().then(() => _queueAgentRender()).catch(console.error);
    });
}
Hooks.on("updateJournalEntry", (doc, changes) => {
    if (!changes.ownership) return;
    globalThis.VirtualAgentWorldMap.sync().then(() => _queueAgentRender()).catch(console.error);
});
for (const h of ["createToken", "updateToken", "deleteToken"]) {
    // A beat later, so the token's new position is readable before the phone redraws.
    Hooks.on(h, (doc) => { if (doc.parent?.id === globalThis.VirtualAgentWorldMap.scene()?.id) setTimeout(_queueAgentRender, 60); });
}


/* ------------------------------------------------------------------ *
 *  NuNu packaging: incoming-text notice.
 *
 *  Upstream counts unread texts but shows nothing when the phone is
 *  closed, so a message mid-scene is easy to miss entirely.
 * ------------------------------------------------------------------ */

function _agentAnnounce(message) {
    try {
        if (!game.settings.get("VirtualAgent", "textNotices")) return;
    } catch (e) { return; }

    const flags = message.flags?.VirtualAgent ?? {};
    const from = flags.overrideName
        || flags.targetName
        || (message.author?.character?.name)
        || message.author?.name
        || "Unknown";

    const text = String(message.content ?? "")
        .replace(/<br\s*\/?>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&nbsp;/g, " ")
        .replace(/\s+/g, " ")
        .trim();
    const preview = text.length > 90 ? `${text.slice(0, 90)}…` : text;

    // Foundry's notify() returns nothing in v12, so there is no element to bind a
    // click to. The notice names the sender and the opening words; the phone is a
    // click away on the calendar widget.
    ui.notifications?.info?.(`${from}: ${preview || "(attachment)"}`, { permanent: false, console: false });

    try {
        const volume = game.settings.get("VirtualAgent", "textNoticeVolume");
        const Audio = foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
        if (volume > 0 && Audio?.play) Audio.play({ src: "sounds/notify.wav", volume, autoplay: true, loop: false }, false);
    } catch (e) { /* no sound is not worth an error */ }
}
