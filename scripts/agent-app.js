/* NuNu packaging: housing and lifestyle from the campaign's Economic Tables.
   Both are monthly, and together they are what the 28th charges. */
const VA_HOUSING = [
    ["Living on the Street", ""], ["Living on the Street in a Vehicle", ""],
    ["Cube Hotel", "500"], ["Flats Cargo Container", "500"], ["Cargo Container", "1000"],
    ["Studio Apartment", "1500"], ["Two-Bedroom Apartment", "2500"], ["Corporate Conapt", "5000"],
    ["Upscale Conapt", "12500"], ["Luxury Penthouse", "25000"], ["Tribeca Mansion", ""],
];
const VA_LIFESTYLE = [["Kibble", "100"], ["Generic Prepak", "300"], ["Good Prepak", "600"], ["Fresh Food", "1500"]];
const VA_LIFESTYLE_COST = Object.fromEntries(VA_LIFESTYLE);
/* NuNu packaging: a character's Role in Cyberpunk RED is an Item of type "role",
   not `system.externalData.role`, which does not exist in the system's data model.
   Upstream reads the missing field, so every Agent ID reads "Citizen". */
function VA_roleOf(actor) {
    if (!actor) return "";
    const role = (actor.itemTypes?.role ?? [])[0];
    return role?.name || actor.system?.externalData?.role || "";
}
/* NuNu packaging: a player is shown by their Agent handle, else their character's name, else their Foundry user name. */
function VA_displayName(u) {
    const handle = u?.getFlag?.("VirtualAgent", "idOverrides")?.handle; if (handle) return handle;
    const last = u?.getFlag?.("VirtualAgent", "lastActorUuid"); const a = last ? fromUuidSync(last) : null;
    return a?.name || u?.character?.name || u?.name || "Unknown";
}
/**
 * Virtual Agent — an Agent device for Foundry VTT (Cyberpunk RED)
 * Target: Foundry V12
 * Version: 1.0.0-beta.1
 */

// Patch3: single shared HTML escape helper used by every ChatMessage.create
// that interpolates user-controlled content. Falls back to a manual escape
// if Foundry's util isn't available.
function _agentEscHTML(s) {
    const v = String(s ?? "");
    if (foundry?.utils?.escapeHTML) return foundry.utils.escapeHTML(v);
    return v.replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
}

class AgentOSApplication extends Application {
    constructor(options = {}) {
        super(options);
        // Start with the boot sequence every time it's physically opened to feel real
        this.currentView = "boot";
        this.bootTimer = null;
        this.activeContactId = null;
        this.showAddContact = false;
        this.searchQuery = "";
        this.editContactId = null;
        this.editContactName = "";
        this.shardSearchQuery = "";
        this.activeShardId = null;
        this.showPayoutModal = false;
        this.showLedgerModal = false;
        this.showShardModal = false;
        this.showEmojiPicker = false;
        // Patch4.5: in-phone modal for editing Agent ID (replaces the
        // immersion-breaking Foundry Dialog popup).
        this.showIdEditModal = false;
        // Patch4.5: in-phone modal for Pay All Players (same reason).
        this.showPayAllModal = false;
        // Patch4.6: in-phone modal for NPC bid name prompt + generic confirm.
        this.showNpcBidModal = false;
        this._pendingNpcBid = null;
        this._pendingConfirm = null; // {kind, payload, title, message}
        // Patch4.8: new-group modal flag.
        this.showNewGroup = false;
        // Patch5.5.5: GM-side add modals for new apps. + button in the app
        // header opens a modal with the same form fields the Sys Admin section
        // used to host. Sys Admin add-forms removed (lists stay in Sys Admin
        // for review; add UI moved to where the GM is actually looking).
        this.showNcpdAddModal = false;
        this.showZigguratAddModal = false;
        this.showGardenAddModal = false;
        // Patch5.5.3: map pin placement state (moved out of Sys Admin to Maps).
        this._mapPinMode = false;
        this._pendingPinX = 50;
        this._pendingPinY = 50;
        this.showMapPinModal = false;
        this.showMapPinManageModal = false;
        // Patch4.8: attachment template picker state.
        this.showAttachPicker = false;
        this._attachKind = "photo"; // photo | video | audio
        this.actorId = null;       // Hardware identity for financial transactions
        this.actorUuid = null;     // UUID for sidebar & synthetic actor detection

        // Map State
        this.mapZoom = 1;
        this.mapX = 0;
        this.mapY = 0;

        // Admin State
        this.selectedAdminActorUuid = null;
        // Patch4 round 2: separate tab state ONLY for the Application Access
        // section in Sys Admin. Decoupled from `selectedAdminActorUuid` so
        // flipping a player tab here doesn't also change the GM's wallet view,
        // transfer source, or any other admin context. "VirtualWallet" = GM's
        // own app-lock flags.
        this._appLockPlayerUuid = "VirtualWallet";

        // Realistic-texting state
        this.typingPeers = {};
        this._typingEmitting = false;
        this._typingStopTimer = null;
        this._typingExpireTimer = null;
        this._chatNearBottom = true;
        this._forceScrollOnNextRender = false;
        this._chatInputDraft = "";
        this._chatInputHadFocus = false;
        // Generic composer drafts — survive cross-client re-renders (e.g. Social post).
        // Keyed by element id so we can extend without changing call sites.
        // Patch3: also tracked per-view so switching to a different auction /
        // contact doesn't carry the previous view's draft into the new one.
        this._composerDrafts = {};
        this._composerFocusId = null;
        this._composerDraftsView = null;

        // Lifecycle: tracks window-level listeners so we can detach on close()
        this._windowEventsBound = false;
        this._onWindowMouseMove = null;
        this._onWindowMouseUp = null;

        // Map pan state — instance-scoped so window mousemove handler sees mousedown writes
        this._panState = { isPanning: false, startX: 0, startY: 0 };

        // NUNU MART store state
        this._storeCatalog = null;       // { Weapons: [...], Ammo: [...], ... }
        this._storeLoading = null;       // in-flight Promise during initial load
        this._storeCategory = "All"; // active category in the list view; "All" = flatten every category
        this._storeSearch = "";          // search filter
        this._storeView = "list";        // "list" | "cart" | "loading"
        // ── 5.6.0 COMBAT app state ──
        this._combatMenu = 'main';   // FFXII-style menu state machine
        this._combatBudget = { move: 'available', action: 'available', bonus: 'available' };
        // ── 5.6.2 ATTACK sub-flow state ──
        // Sub-menu navigation: 'weapon' → 'target' → 'roll' → 'damage' → 'result'
        this._attackPhase  = 'weapon';
        this._attackWeapon = null;   // weapon item id
        this._attackTarget = null;   // token id
        this._attackRoll   = null;   // { total, formula, isCrit, isFumble, rendered }
        this._attackDamage = null;   // { total, formula, rendered }
        // ── 5.7.0 ITEM sub-flow + gamification ──
        this._itemPhase  = 'pick';   // 'pick' | 'result'
        this._itemSelected = null;   // item id
        this._itemResult   = null;   // { name, effect, rendered }
        this._damagePops   = [];     // { id, kind, value, ts } transient list for animation
        // ── 5.7.1 upper-viewport + history state ──
        this._lastCombatAction = null;
        this._skillRollHistory = [];
        this._skillsShrunk     = false;
        // ── 5.6.1 SKILLS search state ──
        this._skillSearch = '';      // live filter substring (lowercased)
        // ── 5.8.6 pre-roll modifier dialog state ──
        this._skillRollPrep = null;
        // ── 5.8.8 attack-roll prep (DV override + modifier + LUCK) ──
        this._attackRollPrep = null;
        // ── 5.8.10 MORE action awaiting target (GRAB / STABILIZE) ──
        this._morePendingAction = null;
        // ── 5.8.10 MOVE distance picker state ──
        this._movePending = null;  // { distanceMax, distanceChosen } or null
        this._storeSearchDebounce = null;
        this._storeScrollPositions = {};  // { "Weapons": 120, "Ammo": 0, ... }
        this._storeFilterAffordable = false; // true = show only items player can afford
        // Patch4.7 (Gotto): price-tier dropdown ("all" | "100" | "500" | ...)
        this._storePriceTier = "all";
        // Patch5.5: NuNu Mart mode toggle ("catalog" | "nightmarket"). Players can flip
        // between the regular catalog and the GM-curated Night Market drop.
        this._storeMode = "catalog";
        // Patch4.7 (Gotto): social feed single-category filter ("all" or a category label)
        this._socialFilter = "all";

        // Window-drag state (custom impl — V12's Draggable was unreliable for our V1 setup)
        this._dragState = { isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 };
        this._onWindowDragMove = null;
        this._onWindowDragUp = null;

        // 1.2.0 — per-device whole-Agent scale (corner-drag grip → Application.setPosition scale).
        try { this._agentScale = Number(game.settings.get("VirtualAgent", "agentScale")) || 1; }
        catch (e) { this._agentScale = 1; }

        // Style Checker state
        this._styleTab = "outfit"; // "outfit" | "gear"

        // Auction House state
        this._auctionView = "list"; // "list" | "detail"
        this._auctionDetailId = null;
        this._pendingAuctionData = null; // optimistic UI: holds mutated auction array until settings.set resolves
    }

    static _formatDayDivider(ts) {
        const d = new Date(ts);
        const today = new Date(); today.setHours(0,0,0,0);
        const day = new Date(d); day.setHours(0,0,0,0);
        const diff = Math.round((today - day) / 86400000);
        if (diff === 0) return "Today";
        if (diff === 1) return "Yesterday";
        if (diff > 1 && diff < 7) return d.toLocaleDateString([], { weekday: 'long' });
        return d.toLocaleDateString([], { month: 'short', day: 'numeric', year: today.getFullYear() === d.getFullYear() ? undefined : 'numeric' });
    }

    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "VirtualAgent-app",
            template: "modules/VirtualAgent/templates/agent-ui.hbs",
            title: "Virtual Agent",
            classes: ["AgentDevice", "agent-popup"],
            width: 380,
            height: 680,
            resizable: false,
            popOut: true,
            minimizable: false
        });
    }

    _getContacts() {
        let contacts = [];

        // 0. The Permanent Party / Group Chat (Seen by everyone)
        let partyName = "Party / Group Net";
        try { partyName = game.settings.get("VirtualAgent", "partyGroupChatName") || partyName; } catch (e) {}
        contacts.push({
            id: "party_group_chat",
            name: partyName,
            isPlayer: false,
            isGroup: true,
            active: true
        });

        // 1. Add other users as contacts
        game.users.forEach(u => {
            if (u.id === game.user.id) return;
            // NuNu packaging: the GM is not a person in the fiction, so they are not
            // listed as someone to text. An existing thread with them still shows,
            // so a GM who does DM a player is not lost.
            if (u.isGM && !game.user.isGM) {
                const hasHistory = game.messages.some((m) => {
                    const f = m.flags?.VirtualAgent;
                    return f?.isAgentMessage && (f.threadId === u.id || (m.author?.id === u.id && f.threadId === game.user.id));
                });
                if (!hasHistory) return;
            }

            let isHidden = u.getFlag("VirtualAgent", "hideOnlineStatus") || false;
            let isJammed = u.getFlag("VirtualAgent", "isJammed") || false;

            let isUserActive = false;
            let isGhost = false;

            if (game.user.isGM) {
                isUserActive = u.active;
                if (isHidden && u.active) isGhost = true;
            } else {
                isUserActive = u.active && !isHidden && !isJammed;
            }

            // Use custom handle from Agent ID if set, fallback to Foundry name
            const idOver = u.getFlag("VirtualAgent", "idOverrides") || {};
            const displayName = idOver.handle || u.character?.name || u.name;
            contacts.push({
                id: u.id,
                name: u.isGM ? `${displayName} (Global Net)` : displayName,
                isPlayer: true,
                active: isUserActive,
                isGhost: isGhost,
                isJammed: isJammed
            });
        });

        let gmUser = game.users.find(u => u.isGM);
        let npcStatuses = gmUser ? (gmUser.getFlag("VirtualAgent", "npcStatuses") || {}) : {};

        // 2. Add custom endpoints
        // Patch3 (CommanderCrunch69 bug): NPC contacts targeted at specific players
        // were sometimes appearing for everyone. Defensive filter — for non-GMs,
        // honour the contact's `targetUserIds` field as authoritative. If the
        // contact has a target list and the current user isn't on it (and isn't
        // the contact owner), drop it. GM always sees all their own contacts.
        let customContacts = game.user.getFlag("VirtualAgent", "customContacts") || [];
        customContacts.forEach(c => {
            if (!game.user.isGM
                && Array.isArray(c.targetUserIds)
                && c.targetUserIds.length > 0
                && !c.targetUserIds.includes(game.user.id)
                && c.ownerId !== game.user.id) {
                // Leaked into this user's flag from a previous targeting; ignore.
                return;
            }
            c.active = npcStatuses[c.id] !== false;
            contacts.push(c);
        });

        // 3. GM ONLY: Dynamic Switchboard
        if (game.user.isGM) {
            let agentMessages = game.messages.filter(m => m.flags.VirtualAgent?.isAgentMessage && m.flags.VirtualAgent.threadId?.startsWith('npc_'));
            agentMessages.forEach(m => {
                let tid = m.flags.VirtualAgent.threadId;
                let exists = contacts.find(c => c.id === tid);

                let npcName = m.flags.VirtualAgent.targetName || m.flags.VirtualAgent.overrideName || "Unknown NPC";
                let ownerUsr = m.author?.isGM ? null : m.author;

                if (m.author?.isGM && m.whisper && m.whisper.length === 1) {
                    ownerUsr = game.users.get(m.whisper[0]);
                }

                if (!exists) {
                    contacts.push({
                        id: tid,
                        name: `${npcName} (via ${ownerUsr ? ownerUsr.name : 'Multi-Sync'})`,
                        isPlayer: false,
                        isSwitchboard: true,
                        ownerId: ownerUsr ? ownerUsr.id : null,
                        originalName: npcName,
                        active: npcStatuses[tid] !== false
                    });
                } else if (!exists.ownerId && ownerUsr) {
                    exists.ownerId = ownerUsr.id;
                    // Use originalName when available; otherwise strip any prior "(via X)" suffix
                    // off the current name so we never produce "undefined (via X)".
                    const baseName = exists.originalName
                        || (exists.name || "Unknown NPC").replace(/\s*\(via\s+[^)]+\)\s*$/i, "").trim()
                        || "Unknown NPC";
                    exists.name = `${baseName} (via ${ownerUsr.name})`;
                    if (!exists.originalName) exists.originalName = baseName;
                }
            });
        }

        // 4. Filter by search query if present (single source of truth)
        if (this.searchQuery) {
            let q = this.searchQuery.toLowerCase();
            contacts = contacts.filter(c => c.name.toLowerCase().includes(q));
        }

        return contacts;
    }

    /**
     * Authoritative Hardware Identity Resolution
     * Ensures GM and Player always agree on where the wallet is located.
     */
    _getIdentity(user) {
        if (!user) return null;
        if (user.isGM && (!this.selectedAdminActorUuid || this.selectedAdminActorUuid === "VirtualWallet")) return "VirtualWallet";

        const targetId = (user.isGM && this.selectedAdminActorUuid) ? this.selectedAdminActorUuid : user.getFlag("VirtualAgent", "lastActorUuid");
        if (targetId) {
            const obj = fromUuidSync(targetId);
            if (obj) return targetId;
        }

        if (user.character) return user.character.uuid;

        // Patch4 round 6 (Ryouhi bug): the old fallback picked the FIRST owned
        // actor, which let Item Piles shop/inventory actors (drink menus, etc.)
        // hijack the player's identity — payments via Pay Contact landed on
        // the shop instead of the PC. Filter to:
        //  - character-type actors only (skip NPCs, vehicles, containers)
        //  - exclude actors with item-piles flags (managed shop containers)
        //  - exclude actors flagged as merchant/vault/auction types
        // Picks the most-recently-modified character to give the multi-PC case
        // a sensible default until the player picks one explicitly via the
        // multi-character dropdown.
        const isItemPilesManaged = (a) => {
            const ip = a.flags?.["item-piles"];
            if (!ip) return false;
            // Some Item Piles versions store the toggle as flags['item-piles'].data.enabled
            // or just by the presence of `data.type`. Treat any populated
            // item-piles flag block as "managed" — players rarely want to
            // identify AS an Item Piles container regardless of subtype.
            return !!(ip.data || ip.enabled || ip.type);
        };
        const candidates = game.actors.filter(a =>
            a.testUserPermission(user, "OWNER") &&
            (a.type === "character") &&
            !isItemPilesManaged(a)
        );
        if (candidates.length > 0) {
            // Multi-PC fallback: prefer the most recently modified character.
            // Stable: same actor wins on every render until the player
            // explicitly switches via the multi-character selector.
            candidates.sort((a, b) => (b._stats?.modifiedTime || 0) - (a._stats?.modifiedTime || 0));
            return candidates[0].uuid;
        }

        return "User." + user.id;
    }

    _getVirtualBalance(user) {
        if (!user) return { balance: 0, path: "flags.VirtualAgent.virtualWalletBalance" };
        const balance = user.getFlag("VirtualAgent", "virtualWalletBalance") ?? (user.isGM ? 1000000 : 0);
        return {
            balance: Number(balance) || 0,
            path: "flags.VirtualAgent.virtualWalletBalance"
        };
    }

    _getActorEurobucks(actor) {
        if (!actor) return { balance: 0, path: "system.wealth.eb" };
        let paths = ["system.wealth.eb", "system.wealth.value", "system.currency.eb"];
        for (let path of paths) {
            let val = foundry.utils.getProperty(actor, path);
            if (val !== undefined) return { balance: typeof val === 'number' ? val : 0, path: path };
        }
        return { balance: 0, path: "system.wealth.eb" };
    }

    /**
     * Resolve a UUID-like identifier into an Actor (or null for User/Virtual cases).
     */
    // Patch4.7 (Gotto): NuNu Mart price-bucket bounds. Returns {min,max} for a
    // dropdown value, or null for "all" / unknown.
    _priceBucketBounds(value) {
        switch (String(value || "").toLowerCase()) {
            case "cheap":     return { min: 0,     max: 100 };
            case "everyday":  return { min: 100,   max: 500 };
            case "costly":    return { min: 500,   max: 1000 };
            case "premium":   return { min: 1000,  max: 5000 };
            case "expensive": return { min: 5000,  max: 10000 };
            case "luxury":    return { min: 10000, max: Number.POSITIVE_INFINITY };
            default:          return null;
        }
    }

    _resolveActor(uuid) {
        if (!uuid || uuid === "VirtualWallet" || uuid.startsWith("User.")) return null;
        const obj = fromUuidSync(uuid);
        return (obj instanceof Actor) ? obj : null;
    }

    // 1.1.2: ONE actor source for the SKILLS app. The list and the roll MUST resolve the
    // same actor — otherwise the list shows one character's skills while the roll targets
    // another (→ "skill item not found" / "No active character", which reads to players as
    // "clicks don't roll"). Primary is the Agent's bound identity (what the wallet, messages,
    // and biomonitor all use), so Skills shows YOUR character regardless of token selection.
    // GMs (no bound identity → actorUuid is "VirtualWallet"/null) fall through to a selected
    // token so they can still roll an NPC's skills.
    // 1.8.2 — stale-binding guard: a bound identity with NO skill items (an old NPC/vehicle/
    // container binding) yields an EMPTY Skills app — reported as "skills not working" by
    // exactly the players whose lastActorUuid points at a skill-less actor. Prefer whichever
    // primary source actually has skills; same resolver everywhere keeps list + roll consistent.
    _resolveSkillsActor() {
        const hasSkills = (a) => { try { return !!a?.items?.some?.(i => i.type === 'skill'); } catch (e) { return false; } };
        const bound = this._resolveActor(this.actorUuid);
        if (hasSkills(bound)) return bound;
        const chr = game.user?.character;
        if (hasSkills(chr)) return chr;
        return bound || chr || canvas?.tokens?.controlled?.[0]?.actor || null;
    }

    // 1.3.0 — NPC vitals privacy. True when NPC HP/SP must be hidden from THIS user: a non-GM,
    // when the GM has turned off "Show NPC HP/SP to Players". GMs always see everything.
    _npcVitalsHidden() {
        if (game.user?.isGM) return false;
        try { return !game.settings.get("VirtualAgent", "showNpcVitalsToPlayers"); }
        catch (e) { return false; }
    }
    // Per-actor gate: hide ONLY NPC vitals (no player owner). Allied PCs stay visible.
    _hideVitalsFor(actor) {
        return this._npcVitalsHidden() && !!actor && !actor.hasPlayerOwner;
    }

    // 1.4.0 — ammo types (cyberpunk-red-core CPR.ammoTypes). The picker mechanizes the precise
    // damage-math types (Basic, AP, Rubber, Sleep); the rest are recorded with a rule reminder for
    // the GM to adjudicate (rather than inventing numbers).
    _ammoTypeList() {
        return [
            { key: 'basic',         label: 'BASIC'  },
            { key: 'armorPiercing', label: 'AP'     },
            { key: 'rubber',        label: 'RUBBER' },
            { key: 'sleep',         label: 'SLEEP'  },
            { key: 'expansive',     label: 'EXPANS' },
            { key: 'incendiary',    label: 'INCEND' },
            { key: 'biotoxin',      label: 'BIOTOX' },
            { key: 'emp',           label: 'EMP'    },
            { key: 'poison',        label: 'POISON' },
            { key: 'acid',          label: 'ACID'   },
            { key: 'flashbang',     label: 'FLASH'  }
        ];
    }
    _ammoRuleNote(t) {
        switch (t) {
            case 'armorPiercing': return 'AP · ablates 2 armor SP instead of 1 (does NOT halve SP or damage). CPR pg 344';
            case 'rubber':        return 'Rubber · no Critical Injury, cannot ablate armor; a target above 1 HP can\'t be dropped below 0 (left at 1 HP). CPR pg 345';
            case 'sleep':         return 'Sleep · NO damage — target makes a DV13 Resist Torture/Drugs check or falls Prone + Unconscious for 1 min. CPR pg 344';
            case 'expansive':     return 'Expansive · on a Foreign Object Critical Injury, reroll the table for a 2nd injury (no Bonus Damage). GM applies. CPR pg 344';
            case 'incendiary':    return 'Incendiary · on damage through armor, target is on fire: 2 HP at end of each Turn until they spend an Action to stop it. GM applies. CPR pg 345';
            case 'biotoxin':      return 'Biotoxin · NO damage — target makes a DV15 Resist Torture/Drugs check or takes 3d6 to HP (no ablation). GM applies. CPR pg 344';
            case 'emp':           return 'EMP · NO damage — target makes a DV15 Cybertech check or has 2 cyberware/electronics disabled 1 min. GM applies. CPR pg 344';
            case 'poison':        return 'Poison · NO damage — target makes a DV13 Resist Torture/Drugs check or takes 2d6 to HP (no ablation). GM applies. CPR pg 345';
            case 'acid':          return 'Acid · GM adjudicates (not in the Core ammo list — see your supplement).';
            case 'flashbang':     return 'Flashbang · NO damage — target makes a DV15 Resist Torture/Drugs check or suffers Damaged Eye + Damaged Ear for 1 min. GM applies. CPR pg 345';
            default:              return '';
        }
    }

    // 1.8.0 — Garden photo uploads live in a dedicated world folder so player uploads never
    // mix with (or expose) the GM's asset tree. Created lazily; parents first. "already
    // exists" errors are expected and ignored — a real failure surfaces at upload time.
    async _ensureGardenUploadDir() {
        let dir = `worlds/${game.world.id}`;
        for (const part of ["virtual-agent", "garden"]) {
            dir += `/${part}`;
            try { await FilePicker.createDirectory("data", dir); } catch (e) { /* EEXIST — fine */ }
        }
        return dir;
    }

    // 1.8.0 — read + downscale a player-chosen image (max 512px, webp with jpeg fallback).
    // Garden photos are avatars; downscaling keeps the world folder tidy and the base64
    // relay to the GM comfortably under Foundry's socket message budget.
    async _readGardenImage(file) {
        const MAX = 512;
        const raw = await new Promise((res, rej) => {
            const r = new FileReader();
            r.onload = () => res(r.result); r.onerror = () => rej(new Error("read failed"));
            r.readAsDataURL(file);
        });
        const img = await new Promise((res, rej) => {
            const i = new Image();
            i.onload = () => res(i); i.onerror = () => rej(new Error("decode failed"));
            i.src = raw;
        });
        const scale = Math.min(1, MAX / Math.max(img.width || 1, img.height || 1));
        const w = Math.max(1, Math.round((img.width || 1) * scale));
        const h = Math.max(1, Math.round((img.height || 1) * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        let out = c.toDataURL("image/webp", 0.85);
        if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/jpeg", 0.85);
        if (out.length > 900000) out = c.toDataURL("image/jpeg", 0.6);
        return out;
    }

    // 1.7.0 — REACTIVE dodge: called AFTER the attack roll. Returns a Promise<{dodged, evasionTotal}>
    // resolved when the defender (or the GM, locally) answers — so the existing damage block runs with the
    // dodge's Evasion already folded into dvOverride. (This is the only dodge path — there is no pre-roll prompt.)
    _resolveDodgeAfterRoll(wep, attackTotal) {
        return new Promise((resolve) => {
            try {
                let on = true;
                try { on = game.settings.get("VirtualAgent", "reactiveDodgePrompt"); } catch (e) {}
                const prep = this._attackRollPrep;
                const tgt = canvas?.tokens?.get(this._attackTarget)?.actor;
                if (!on || !tgt) return resolve({ dodged: false });
                const canDodge = !!(prep && (prep.isMeleeWep || prep.canEvade));
                const attackerName = this._resolveActor(this.actorUuid)?.name || game.user.name;
                const weaponName = wep?.name || "a weapon";
                const hasResponder = tgt.hasPlayerOwner
                    ? game.users.some(u => u.active && !u.isGM && u.id !== game.user.id && tgt.testUserPermission(u, "OWNER"))
                    : game.users.some(u => u.active && u.isGM && u.id !== game.user.id);
                console.log(`[VirtualAgent dodge] post-roll attack=${attackTotal} target=${tgt.name} canDodge=${canDodge} hasResponder=${hasResponder}`);
                if (hasResponder) {
                    const reqId = `${game.user.id}-${Date.now()}`;
                    this._pendingDodges = this._pendingDodges || {};
                    let done = false;
                    const finish = (r) => { if (done) return; done = true; try { delete this._pendingDodges[reqId]; } catch (e) {} resolve(r || { dodged: false }); };
                    this._pendingDodges[reqId] = finish;
                    game.socket.emit("module.VirtualAgent", { action: "combatDodgeQuery", reqId, attackerUserId: game.user.id, attackerName, targetUuid: tgt.uuid, weaponName, canDodge, attackTotal });
                    ui.notifications.info(`Waiting for ${tgt.name} to react to the attack…`);
                    setTimeout(() => finish({ dodged: false }), 60000);   // never hang the attack
                } else if (game.user.isGM) {
                    this._showDodgeDialog(tgt, attackerName, weaponName, canDodge, (dodged, ev) => resolve({ dodged, evasionTotal: ev }), attackTotal);
                } else {
                    resolve({ dodged: false });
                }
            } catch (e) { console.warn("[VirtualAgent] _resolveDodgeAfterRoll:", e); resolve({ dodged: false }); }
        });
    }

    // 1.5.4 — the dodge prompt itself, reused by BOTH the socket handler (remote defender's client)
    // and the GM-local fallback in _resolveDodgeAfterRoll. respond(dodged, evasionTotal) wires the answer back.
    _showDodgeDialog(tgt, attackerName, weaponName, canDodge, respond, attackTotal) {
        try {
            let _answered = false;
            const _ans = (d, e) => { if (_answered) return; _answered = true; try { respond(d, e); } catch (er) {} };
            const _dex = Number(tgt.system?.stats?.dex?.value ?? 0);
            const _evItem = tgt.items?.find(it => it.type === "skill" && it.name?.toLowerCase() === "evasion");
            const _evLvl = Number(_evItem?.system?.level ?? 0);
            const _buttons = {};
            if (canDodge) {
                _buttons.dodge = { label: "DODGE", callback: async () => {
                    try {
                        const r = new Roll(`1d10x10 + ${_dex} + ${_evLvl}`);
                        await r.evaluate({ async: true });
                        await r.toMessage({ speaker: ChatMessage.getSpeaker({ actor: tgt }), flavor: `<strong>${tgt.name}</strong> dodges — DEX ${_dex} + Evasion ${_evLvl} + 1d10 (CPR pg 172)` });
                        _ans(true, r.total);
                    } catch (e) { console.warn("[VirtualAgent] dodge roll failed:", e); _ans(false, 0); }
                } };
            }
            _buttons.take = { label: canDodge ? "TAKE THE HIT" : "OK", callback: () => _ans(false, 0) };
            new Dialog({
                title: "Incoming Attack — Dodge?",
                content: `<div style="font-family: monospace; font-size: 13px; line-height: 1.4;">
                    <p><strong>${attackerName || "Someone"}</strong> attacks <strong>${tgt.name}</strong> with <strong>${weaponName || "a weapon"}</strong>${(attackTotal === undefined || attackTotal === null) ? "" : ` — rolled <strong>${attackTotal}</strong> to hit`}.</p>
                    ${canDodge
                        ? `<p>Dodge with Evasion (DEX ${_dex} + Evasion ${_evLvl} + 1d10)? Your roll becomes the DV they must beat. Dodging is a free reaction — it does NOT cost your Action. (CPR pg 172)</p>`
                        : `<p style="color:#ff7799;">No dodge available — ranged fire can only be dodged with REF 8+ (CPR pg 173). Brace for it.</p>`}
                </div>`,
                buttons: _buttons,
                default: canDodge ? "dodge" : "take",
                close: () => _ans(false, 0)
            }, { classes: ["dialog", "virtual-agent-dodge"] }).render(true);
        } catch (e) { console.warn("[VirtualAgent] _showDodgeDialog failed:", e); respond(false, 0); }
    }

    /** NuNu packaging: the flag owners behind every player's phone (their character if assigned, else the user). GM excluded. */
    _everyoneOwners() {
        const owners = [];
        for (const u of game.users.filter((x) => !x.isGM)) {
            const identity = this._getIdentity(u);
            const a = (identity && identity !== "VirtualWallet" && !identity.startsWith("User.")) ? this._resolveActor(identity) : null;
            const o = a || u; if (!owners.includes(o)) owners.push(o);
        }
        return owners;
    }

    async getData() {
        const data = await super.getData();
        // 5.8.14 unconditional diagnostic — fires every render
        try {
            const _gc = game.combat;
            const _cb = _gc?.combatant;
            const _ca = _cb?.actor;
            const _ma = game.user?.character;
            // 1.8.2 — in the SKILLS view, also log WHO the skills resolver picked and how many
            // skill items it has. "Skills not working" reports need exactly this to localize.
            let _skDiag = '';
            if (this.currentView === 'skills') {
                const _sa = this._resolveSkillsActor();
                const _sn = _sa ? (_sa.items?.filter?.(i => i.type === 'skill')?.length ?? '?') : 'N/A';
                _skDiag = ` | skillsActor: ${_sa?.name || 'NULL'} | skillItems: ${_sn}`;
            }
            console.log('[AgentDevice 5.8.16] getData | view:', this.currentView,
                '| combat.started:', _gc?.started ?? 'no combat',
                '| combatant:', _cb?.name || 'none',
                '| combatant.actor:', _ca?.name || 'NULL',
                '| combatant.actor.items.size:', _ca?.items?.size ?? 'N/A',
                '| my user.character:', _ma?.name || 'NONE',
                '| my actorUuid:', this.actorUuid, _skDiag);
        } catch (e) { console.warn('[AgentDevice 5.8.16] diag failed:', e); }

        // --- IDENTITY RESOLUTION (authoritative, runs every render) ---
        this.actorUuid = this._getIdentity(game.user);
        const actor = this._resolveActor(this.actorUuid);
        const isVirtualWallet = !actor;

        // Build list of owned actors for multi-character selector (non-GM only)
        if (!game.user.isGM) {
            data.ownedActors = game.actors
                .filter(a => a.testUserPermission(game.user, "OWNER") && a.type === "character")
                .map(a => ({ uuid: a.uuid, name: a.name, img: a.img || "icons/svg/mystery-man.svg", isActive: a.uuid === this.actorUuid }));
            data.hasMultipleActors = data.ownedActors.length > 1;
        } else {
            data.ownedActors = [];
            data.hasMultipleActors = false;
        }

        // --- MASTER DATA CONTRACT ---
        data.isGM = game.user.isGM;
        // 5.5.26: BROWSE on the Add Contact modal needs to be gated on
        // Foundry's actual FILES_BROWSE permission, not on isGM. In V12 the
        // default for FILES_BROWSE is Assistant GM (role 3) — Players don't
        // have it unless the GM has explicitly granted it in Configure
        // Permissions. Without the permission, opening the FilePicker either
        // silently fails or shows an empty picker. We gate the button on
        // game.user.can("FILES_BROWSE") so players whose GM has granted
        // file browsing see it, and the rest see only IMPORT.
        try { data.canBrowseFiles = !!game.user.can?.("FILES_BROWSE"); }
        catch (e) { data.canBrowseFiles = game.user.isGM; }
        data.currentView = this.currentView || "boot";
        data.activeContactId = this.activeContactId;
        data.showAddContact = this.showAddContact || false;
        data.showPayoutModal = this.showPayoutModal || false;
        data.showLedgerModal = this.showLedgerModal || false;
        data.showShardModal = this.showShardModal || false;
        data.showEmojiPicker = this.showEmojiPicker || false;
        data.selectedAdminActorUuid = this.selectedAdminActorUuid;
        data.editContactId = this.editContactId;
        data.editContactName = this.editContactName;
        data.editContactAvatar = this.editContactAvatar || "";
        data.searchQuery = this.searchQuery;
        data.shardSearchQuery = this.shardSearchQuery;
        // In-game clock: try Simple Calendar API → GM-set manual clock → real time fallback
        let igTime = null;
        try {
            if (globalThis.SimpleCalendar?.api) {
                const dt = SimpleCalendar.api.currentDateTime();
                if (dt) {
                    const hh = String(dt.hour).padStart(2, '0');
                    const mm = String(dt.minute).padStart(2, '0');
                    igTime = `${hh}:${mm}`;
                }
            }
        } catch (e) {}
        if (!igTime) {
            try {
                const manualClock = game.settings.get("VirtualAgent", "inGameClock");
                if (manualClock) igTime = manualClock;
            } catch (e) {}
        }
        data.time = igTime || new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        data.hasSimpleCalendar = !!globalThis.SimpleCalendar?.api;
        data.isIngameClock = !!igTime;
        data.gameUserId = game.user.id;

        // World settings (uiSkin, mapImagePath, socialFeedArticles) — defaults if registration missed
        try { data.uiSkin = game.settings.get("VirtualAgent", "uiSkin") || "red"; } catch (e) { data.uiSkin = "red"; }
        const REDMAP = "modules/VirtualAgent/assets/night-city-map-red-final-v2.png";
        const HOLOMAP = "modules/VirtualAgent/assets/cyberpunk-holophone/night-city-sat-map.png";
        try {
            const cfgMap = game.settings.get("VirtualAgent", "mapImagePath");
            // Auto-swap to the 2077 map when skin is 2077 and the GM hasn't overridden the default.
            data.mapImagePath = (cfgMap && cfgMap !== REDMAP) ? cfgMap
                : (data.uiSkin === "2077" ? HOLOMAP : REDMAP);
        } catch (e) { data.mapImagePath = REDMAP; }
        try {
            const raw = game.settings.get("VirtualAgent", "socialFeedArticles");
            const parsed = Array.isArray(raw) ? raw : (typeof raw === "string" && raw.trim() ? JSON.parse(raw) : []);
            // Decorate each entry with display-time fields.
            // Patch4 (Gotto Goho): newest-first ordering, matches actual social
            // media UX where the latest post is the most visible.
            let articles = parsed.map((a, i) => ({
                id: a.id || `feed_${i}`,
                category: a.category || "Feed",
                text: a.text || "",
                authorId: a.authorId || null,
                authorName: a.authorName || "",
                // Patch5.5: Screamsheet flag flows through so the template can
                // pick the styled card layout. Defaults to false for legacy posts.
                isScreamsheet: !!a.isScreamsheet,
                timestamp: a.timestamp || 0,
                canDelete: game.user.isGM || (a.authorId === game.user.id)
            })).sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            // Patch4.7 (Gotto): single-category filter. `_socialFilter` is
            // "all" by default or one of the visible category labels.
            const socialFilter = this._socialFilter || "all";
            // Build the unique category set for the filter chip strip.
            const catSet = new Set();
            articles.forEach(a => { if (a.category) catSet.add(a.category); });
            data.socialFilterCategories = Array.from(catSet).sort();
            data.socialFilter = socialFilter;
            if (socialFilter !== "all") {
                articles = articles.filter(a => a.category === socialFilter);
            }
            data.socialFeedArticles = articles;
        } catch (e) {
            data.socialFeedArticles = [];
            data.socialFilterCategories = [];
            data.socialFilter = "all";
        }
        // GM editor uses "Category | Text" lines view of the JSON
        data.socialFeedRaw = (data.socialFeedArticles || [])
            .map(a => `${a.category || ""} | ${a.text || ""}`)
            .join("\n");

        // Custom NuNu Mart settings (GM only)
        try {
            data.customStoreItemsRaw = game.settings.get("VirtualAgent", "customStoreItems") || "[]";
            data.customStorePacks = game.settings.get("VirtualAgent", "customStorePacks") || "";
            // Patch4.7 follow-up: list available Item-type packs in this world
            // so the GM can copy the exact pack ID into the custom-packs list
            // instead of guessing the namespace. Filters out the system's core
            // compendiums (already pulled by default) and non-Item packs.
            try {
                data.availableStorePacks = Array.from(game.packs || [])
                    .filter(p => {
                        if (!p?.metadata) return false;
                        if (p.metadata.type !== "Item") return false;
                        // Hide the system's own pre-baked CPR packs — already in the catalog.
                        if (p.metadata.packageType === "system") return false;
                        return true;
                    })
                    .map(p => ({
                        id: p.metadata.id || p.collection,
                        label: p.metadata.label || p.metadata.id || p.collection,
                        packageType: p.metadata.packageType || "",
                        packageName: p.metadata.packageName || ""
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label));
            } catch (e) {
                data.availableStorePacks = [];
            }
            // Patch3 (CommanderCrunch69): parsed view for one-click removal in admin UI.
            try {
                const _parsed = JSON.parse(data.customStoreItemsRaw);
                data.customStoreItemsParsed = Array.isArray(_parsed) ? _parsed : [];
            } catch (e) { data.customStoreItemsParsed = []; }
            // Patch3.2: GM gates surfaced for the admin UI.
            data.storeMaxPrice        = Number(game.settings.get("VirtualAgent", "storeMaxPrice")) || 0;
            data.storeSourceFilter    = game.settings.get("VirtualAgent", "storeSourceFilter") || "all";
            data.storeLockedCategories = game.settings.get("VirtualAgent", "storeLockedCategories") || "";
            data.storeBlacklist       = game.settings.get("VirtualAgent", "storeBlacklistIds") || "";
            data.storeSourceOptions = [
                { id: "all",    label: "All (core + custom)" },
                { id: "core",   label: "Core / compendium only" },
                { id: "custom", label: "Custom items only" }
            ];
            // Parse blacklist as a list of entries for chip-style removal.
            data.storeBlacklistEntries = data.storeBlacklist
                .split(/[,\n]/).map(s => s.trim()).filter(Boolean);
        } catch (e) {
            data.customStoreItemsRaw = "[]";
            data.customStorePacks = "";
            data.customStoreItemsParsed = [];
            data.availableStorePacks = [];
            data.storeMaxPrice = 0;
            data.storeSourceFilter = "all";
            data.storeLockedCategories = "";
            data.storeBlacklist = "";
            data.storeBlacklistEntries = [];
            data.storeSourceOptions = [];
        }

        // --- HARDWARE IDENTITY & BALANCES ---
        data.actorId = actor?.id || "VIRTUAL";
        data.actorUuid = this.actorUuid || "User." + game.user.id;
        data.actorRole = VA_roleOf(actor) || "Citizen";
        data.actorHandle = actor?.system?.externalData?.handle || game.user.name;
        data.actorIdShort = (actor?.id || game.user.id).substring(0, 8).toUpperCase();
        data.isVirtualWallet = isVirtualWallet;

        // Custom ID fields (user-editable overrides)
        const idOverrides = game.user.getFlag("VirtualAgent", "idOverrides") || {};
        data.idSinStatus = idOverrides.sinStatus || "Registered";
        data.idClearance = idOverrides.clearance || "Verified";
        data.idSubtitle = idOverrides.subtitle || "Citizen Priority A+";
        data.idCustomHandle = idOverrides.handle || "";
        data.displayHandle = data.idCustomHandle || data.actorHandle;

        // --- AGENT ID VIEW: GM sees all players' cards, players see read-only own card ---
        data.canEditId = game.user.isGM;
        if (game.user.isGM) {
            // Build player list for GM's ID selector
            const idPlayers = game.users.filter(u => !u.isGM).map(u => {
                const uIdentity = this._getIdentity(u);
                const uActor = this._resolveActor(uIdentity);
                return { id: u.id, name: u.name, actorName: uActor?.name || u.name, img: uActor?.img || "icons/svg/mystery-man.svg" };
            });
            data.idPlayerList = idPlayers;
            // Default to first player if no target selected
            if (!this._idViewTargetUserId && idPlayers.length > 0) {
                this._idViewTargetUserId = idPlayers[0].id;
            }
            data.idTargetUserId = this._idViewTargetUserId;
            // Resolve target user's ID card data
            const targetUser = game.users.get(this._idViewTargetUserId);
            if (targetUser) {
                const tIdentity = this._getIdentity(targetUser);
                const tActor = this._resolveActor(tIdentity);
                const tOverrides = targetUser.getFlag("VirtualAgent", "idOverrides") || {};
                // Patch4.5 (Aeroshifter): GM also sees the player's customised
                // displayName when reviewing their card, so the GM panel
                // matches what the player sees on their own device.
                data.idViewName = tOverrides.displayName || tActor?.name || targetUser.name;
                data.idViewRole = VA_roleOf(tActor) || "Citizen";
                data.idViewHandle = tOverrides.handle || tActor?.system?.externalData?.handle || targetUser.name;
                data.idViewIdShort = (tActor?.id || targetUser.id).substring(0, 8).toUpperCase();
                data.idViewSinStatus = tOverrides.sinStatus || "Registered";
                data.idViewClearance = tOverrides.clearance || "Verified";
                data.idViewSubtitle = tOverrides.subtitle || "Citizen Priority A+";
                data.idViewImg = tActor?.img || "icons/svg/mystery-man.svg";
            }
        } else {
            // Player sees own card — resolve directly from actor (actorName isn't set yet).
            // Patch4.5 (Aeroshifter request): owner can override the displayed
            // real name on their OWN ID card via idOverrides.displayName.
            // Public handle (what other players see in contacts / chat) is
            // unchanged — it uses idOverrides.handle separately. This lets a
            // netrunner show "Vincent Cross" on their own Global Registry
            // while still appearing as "GhostRunner" to everyone else.
            data.idViewName = idOverrides.displayName || actor?.name || game.user.name;
            data.idViewRole = data.actorRole;
            data.idViewHandle = data.displayHandle;
            data.idViewIdShort = data.actorIdShort;
            data.idViewSinStatus = data.idSinStatus;
            data.idViewClearance = data.idClearance;
            data.idViewSubtitle = data.idSubtitle;
            data.idViewImg = actor?.img || "icons/svg/mystery-man.svg";
        }

        // Patch4.5: in-phone modal state for Pay All Players (replaces
        // the immersion-breaking Foundry Dialog popup).
        data.showPayAllModal = !!this.showPayAllModal;

        // Patch4.8: attachment template picker state.
        data.showAttachPicker = !!this.showAttachPicker;
        data.attachKind = this._attachKind || "photo";

        // Patch4.8: new-group modal state + candidate lists.
        data.showNewGroup = !!this.showNewGroup;
        if (this.showNewGroup) {
            // Players visible to the current user (everyone but self).
            data.groupCandidatePlayers = game.users.filter(u => u.id !== game.user.id).map(u => ({
                id: u.id,
                name: VA_displayName(u)
            }));
            // NPC contacts the current user has on their device. GMs get the
            // union of their own NPCs plus any NPCs in other users' contact
            // lists (so they can pull anyone into a group).
            // Patch5.0.1 (Gotto): filter out existing groups (`isGroup` /
            // `isCustomGroup` / id starting with `pcgroup_`) from the
            // candidate list — only individual NPC contacts should appear
            // as group members.
            const isPickableNpc = (c) => c
                && !c.isPlayer
                && !c.isGroup
                && !c.isCustomGroup
                && !String(c.id || "").startsWith("pcgroup_")
                && c.id !== "party_group_chat";
            const myNpcs = (game.user.getFlag("VirtualAgent", "customContacts") || []).filter(isPickableNpc);
            const seen = new Set(myNpcs.map(c => c.id));
            const npcs = myNpcs.map(c => ({ id: c.id, name: c.name }));
            if (game.user.isGM) {
                for (const u of game.users) {
                    if (u.id === game.user.id) continue;
                    const theirs = u.getFlag("VirtualAgent", "customContacts") || [];
                    for (const c of theirs) {
                        if (!isPickableNpc(c)) continue;
                        if (seen.has(c.id)) continue;
                        seen.add(c.id);
                        npcs.push({ id: c.id, name: c.name });
                    }
                }
            }
            data.groupCandidateNpcs = npcs;
        } else {
            data.groupCandidatePlayers = [];
            data.groupCandidateNpcs = [];
        }

        // Patch4.6: in-phone NPC-bid name prompt + generic confirm modal.
        data.showNpcBidModal = !!this.showNpcBidModal;
        data.showConfirmModal = !!this._pendingConfirm;
        if (this._pendingConfirm) {
            data.confirmModal = {
                title: this._pendingConfirm.title || "Confirm",
                message: this._pendingConfirm.message || "Are you sure?",
                confirmLabel: this._pendingConfirm.confirmLabel || "CONFIRM",
                accent: this._pendingConfirm.accent || "red" // red | cyan | gold
            };
        }

        // Patch4.5: in-phone modal state for the Edit Agent ID dialog.
        // Pre-populates the form with the currently-viewed target's overrides
        // so opening the modal mirrors what's currently saved.
        data.showIdEditModal = !!this.showIdEditModal;
        if (this.showIdEditModal) {
            const editTargetId = game.user.isGM ? this._idViewTargetUserId : game.user.id;
            const editTarget = game.users.get(editTargetId);
            const eOver = editTarget?.getFlag("VirtualAgent", "idOverrides") || {};
            data.idEdit = {
                targetName: editTarget?.name || "—",
                displayName: eOver.displayName || "",
                handle: eOver.handle || "",
                subtitle: eOver.subtitle || "Citizen Priority A+",
                clearance: eOver.clearance || "Verified",
                sinStatus: eOver.sinStatus || "Registered"
            };
            data.idEditSinOptions = ["Registered", "No SIN", "Forged", "Nomad", "Corporate", "Classified"];
        }

        let actorCurrency = 0;
        let transactions = [];
        if (isVirtualWallet) {
            actorCurrency = this._getVirtualBalance(game.user).balance;
            transactions = game.user.getFlag("VirtualAgent", "virtualWalletTransactions") || [];
            data.actorName = (this.actorUuid === "VirtualWallet") ? "System Fund (Master)" : (game.user.name + " (Digital)");
        } else {
            actorCurrency = this._getActorEurobucks(actor).balance;
            // CPR stores wealth transactions as [sentence, reason] tuples at
            // system.wealth.transactions (written by deltaLedgerProperty).
            // Fall back to our legacy AgentDevice.transactions flag for any
            // pre-CPR-sync entries.
            const cprLedger = foundry.utils.getProperty(actor, "system.wealth.transactions");
            if (Array.isArray(cprLedger) && cprLedger.length) {
                transactions = cprLedger.map((entry) => {
                    const sentence = Array.isArray(entry) ? (entry[0] || "") : String(entry);
                    const reason   = Array.isArray(entry) ? (entry[1] || "") : "";
                    const numMatch = sentence.match(/(-?\d+)/);
                    const amount   = numMatch ? Math.abs(Number(numMatch[1])) : 0;
                    // Direction priority: 1) our Agent reason 2) CPR keywords 3) numeric sign
                    let isPositive = null;
                    if (/^Agent:\s*To\b/i.test(reason)) isPositive = false;
                    else if (/^Agent:\s*From\b/i.test(reason)) isPositive = true;
                    if (isPositive === null) {
                        if (/decreased\s+by/i.test(sentence)) isPositive = false;
                        else if (/increased\s+by/i.test(sentence)) isPositive = true;
                    }
                    if (isPositive === null) {
                        isPositive = !!(numMatch && Number(numMatch[1]) > 0);
                    }
                    return { label: reason || sentence, amount, isPositive, date: "" };
                });
            } else {
                transactions = actor.getFlag("VirtualAgent", "transactions") || [];
            }
            data.actorName = actor.name;
        }
        data.actorCurrencyRaw = Number(actorCurrency) || 0;
        data.actorCurrency = data.actorCurrencyRaw.toLocaleString();
        data.transactions = transactions.slice().reverse().slice(0, 10);

        // --- BIOMONITOR (TRAUMA TEAM) — Actor only ---
        if (actor instanceof Actor) {
            const hp = actor.system?.derivedStats?.hp || { value: 0, max: 0 };
            data.hpCurrent = hp.value;
            data.hpMax = hp.max;
            const clamp = Math.clamp ?? Math.clamped ?? ((v, lo, hi) => Math.max(lo, Math.min(hi, v)));
            data.hpPercent = clamp((hp.value / (hp.max || 1)) * 100, 0, 100);
            data.hpColor = data.hpPercent > 50 ? "#00ffcc" : (data.hpPercent > 25 ? "#ffcc00" : "#ff3333");
            data.woundState = data.hpPercent === 100 ? "Stable" : (data.hpPercent > 0 ? "Wounded" : "Critical");
            data.pulseRate = data.hpPercent > 0 ? (60 + Math.floor(Math.random() * 20)) : 0;

            // Humanity (cyberpsychosis tracker)
            const humanity = actor.system?.derivedStats?.humanity || { value: 0, max: 0 };
            data.humanityCurrent = humanity.value ?? 0;
            data.humanityMax = humanity.max ?? 0;
            data.humanityPercent = clamp((data.humanityCurrent / (data.humanityMax || 1)) * 100, 0, 100);
            data.humanityColor = data.humanityPercent > 50 ? "#e040fb" : (data.humanityPercent > 25 ? "#ffcc00" : "#ff3333");
            data.humanityStatus = data.humanityPercent > 75 ? "Stable" : (data.humanityPercent > 50 ? "Stressed" : (data.humanityPercent > 25 ? "Unstable" : "CYBERPSYCHOSIS RISK"));
        } else {
            data.hpCurrent = 100; data.hpMax = 100; data.hpPercent = 100;
            data.hpColor = "#00ffcc"; data.woundState = "System Stable"; data.pulseRate = 72;
            data.humanityCurrent = 40; data.humanityMax = 40; data.humanityPercent = 100;
            data.humanityColor = "#e040fb"; data.humanityStatus = "Stable";
        }

        // Patch4.7 (Gotto): Trauma Team coverage. Per-user flag (`ttCoverage`).
        // Empty / falsy = no coverage (panic button hidden, REO Meatwagon note).
        // Non-empty = coverage active, the value is the tier label shown on the
        // button (Bronze / Silver / Gold / Platinum / custom string).
        const ttRaw = game.user.getFlag("VirtualAgent", "ttCoverage");
        data.isTraumaTeamClient = !!(ttRaw && String(ttRaw).trim().length);
        data.traumaTeamTier = data.isTraumaTeamClient ? String(ttRaw).trim() : "NONE";

        // --- REPUTATION (NetStatus) ---
        // Reads from a flag for portability across CPR sheet versions.
        // Falls back to system.reputation.value if the system exposes it.
        const repFlag = (actor instanceof Actor)
            ? actor.getFlag("VirtualAgent", "repScore")
            : game.user.getFlag("VirtualAgent", "repScore");
        const repSys = (actor instanceof Actor)
            ? foundry.utils.getProperty(actor, "system.reputation.value")
            : undefined;
        const repScore = Number(repFlag ?? repSys ?? 0) || 0;
        data.repScore = repScore;
        data.repRank = repScore >= 80 ? "Legend"
            : repScore >= 50 ? "Rep+"
            : repScore >= 20 ? "Streetwise"
            : repScore >= 5  ? "Known"
            : "Nobody";

        // --- APPS & PERMISSIONS ---
        const ICON_BASE = "modules/VirtualAgent/assets/cyberpunk-holophone/icons";
        const is2077 = (data.uiSkin === "2077");
        data.allApps = [
            { id: 'chat',   label: 'MESSENGER', icon: 'fas fa-comment-dots',   color: 'var(--neon-cyan)',   iconImg: is2077 ? `${ICON_BASE}/chat.png`   : null },
            { id: 'data',   label: 'DATAPOOL',  icon: 'fas fa-database',       color: 'var(--neon-cyan)',   iconImg: is2077 ? `${ICON_BASE}/data.png`   : null },
            { id: 'creds',  label: 'WALLET',    icon: 'fas fa-wallet',         color: 'var(--creds-gold)',  iconImg: is2077 ? `${ICON_BASE}/creds.png`  : null },
            { id: 'map',    label: 'SAT MAP',   icon: 'fas fa-map-marked-alt', color: 'var(--neon-yellow)', iconImg: is2077 ? `${ICON_BASE}/map.png`    : null },
            { id: 'bio',    label: 'BIOMON',    icon: 'fas fa-heartbeat',      color: '#ff3333',            iconImg: is2077 ? `${ICON_BASE}/bio.png`    : null },
            { id: 'store',  label: 'NUNU MART',   icon: 'fas fa-shopping-cart',  color: '#00ffcc',            iconImg: is2077 ? `${ICON_BASE}/optics.png` : null },
            { id: 'id',     label: 'AGENT ID',  icon: 'fas fa-id-card',        color: '#4488ff',            iconImg: is2077 ? `${ICON_BASE}/id.png`     : null },
            { id: 'social', label: 'SOCIAL',    icon: 'fas fa-share-alt',      color: '#ff9900',            iconImg: is2077 ? `${ICON_BASE}/social.png` : null },
            { id: 'style',  label: 'STYLE',     icon: 'fas fa-tshirt',         color: '#e040fb',            iconImg: is2077 ? `${ICON_BASE}/style.png`  : null },
            { id: 'rep',    label: 'CONTACTS',    icon: 'fas fa-handshake',      color: '#64ffda',            iconImg: is2077 ? `${ICON_BASE}/rep.png`    : null },
            { id: 'auction',label: 'BLACK MKT', icon: 'fas fa-gavel',          color: '#ff6e40',            iconImg: is2077 ? `${ICON_BASE}/auction.png`: null },
            // 5.6.0: COMBAT (FFXII-style menu-driven combat HUD) + SKILLS
            // (folded-out skill picker). Combat tile glows when game.combat
            // is active. Skills tile is always open.
            { id: 'combat', label: 'COMBAT',    icon: 'fas fa-crosshairs',     color: '#ff3366',            iconImg: null },
            { id: 'skills', label: 'SKILLS',    icon: 'fas fa-list-check',     color: '#22ddff',            iconImg: null },
            // Patch5.5 apps (Black Chrome / All About Agents inspired)
            // Patch5.5.3 canon tune: NCPD law-enforcement neon blue (matches in-fiction
            //   NCPD database UI hue), Ziggurat deep Arasaka-tower violet + data-fortress
            //   icon (Ziggurat is a Net data tower in 2077 lore, not a city skyline),
            //   The Garden Cyberpunk neon magenta (Black Chrome / Edgerunner dating palette).
            { id: 'ncpd',   label: 'BOUNTIES',   icon: 'fas fa-fingerprint',    color: '#3a86ff',            iconImg: null },
            { id: 'ziggurat', label: 'ZIGGURAT', icon: 'fas fa-database',      color: '#7c4dff',            iconImg: null },
            { id: 'garden', label: 'THE GARDEN',icon: 'fas fa-seedling',       color: '#ff1493',            iconImg: null }
        ];
        data.adminIconImg = is2077 ? `${ICON_BASE}/admin.png` : null;
        // Patch5.5: new apps default to ON for new tables. GM can toggle off via Sys Admin → Application Access.
        const defaultApps = ['chat', 'data', 'creds', 'map', 'id', 'social', 'bio', 'store', 'style', 'rep', 'auction', 'ncpd', 'ziggurat', 'garden', 'combat', 'skills'];

        // Patch4 round 2: app-lock toggles use their OWN flag owner derived
        // from `_appLockPlayerUuid`, NOT the GM's `actorUuid`. This is the key
        // scope fix — tabs only affect Application Access, nothing else.
        let appLockFlagOwner = null;
        if (game.user.isGM) {
            const tabUuid = this._appLockPlayerUuid || "VirtualWallet";
            if (tabUuid === "VirtualWallet" || tabUuid === "Everyone") {
                appLockFlagOwner = game.user; // GM's own flags (the Everyone tab displays these and writes to all)
            } else if (tabUuid.startsWith("User.")) {
                appLockFlagOwner = game.users.get(tabUuid.split(".")[1]) || game.user;
            } else {
                appLockFlagOwner = this._resolveActor(tabUuid) || game.user;
            }
        } else {
            // Player view — they see their own character's app-locks
            appLockFlagOwner = (actor instanceof Actor) ? actor : game.user;
        }
        // Patch5.5.19: use a one-time migration marker instead of the previous
        // heuristic. The 5.5.18 logic (detect new-5.5 app in saved set → trust
        // saved) had its own bug: when GM toggled a new app OFF, saved no longer
        // contained it, the heuristic thought the user was pre-5.5, and the
        // union re-added the app. End result was the toggle off didn't stick.
        //
        // Per-owner `unlockedAppsMigrated5_N` flag. The first time this code
        // runs for an owner with a saved set, merge new defaults in AND set the
        // flag. From then on, saved set is authoritative.
        //
        // 5.6.1: bumped marker to `5_6` so existing users who already migrated
        // under 5.5 get a one-time re-merge that picks up COMBAT + SKILLS
        // (added to defaultApps in 5.6.0). After this re-merge, the 5_6 marker
        // is set and saved becomes authoritative again — including any GM
        // toggle-offs of the newly added apps.
        const savedUnlocked = appLockFlagOwner.getFlag("VirtualAgent", "unlockedApps");
        const hasMigrated = !!appLockFlagOwner.getFlag("VirtualAgent", "unlockedAppsMigrated5_6");
        if (Array.isArray(savedUnlocked) && savedUnlocked.length > 0) {
            if (hasMigrated) {
                // Saved is canonical — respect GM toggles in both directions.
                data.unlockedApps = savedUnlocked;
            } else {
                // First post-5.6 render — merge new defaults, write back, set marker.
                const missing = defaultApps.filter(a => !savedUnlocked.includes(a));
                const merged = missing.length > 0 ? [...savedUnlocked, ...missing] : savedUnlocked;
                data.unlockedApps = merged;
                // Persist the merged set + migration marker. Fire-and-forget;
                // any error here doesn't block the render.
                if (game.user.isGM || appLockFlagOwner.id === game.user.id) {
                    try {
                        appLockFlagOwner.setFlag("VirtualAgent", "unlockedApps", merged);
                        appLockFlagOwner.setFlag("VirtualAgent", "unlockedAppsMigrated5_6", true);
                    } catch (e) { /* read-only render context — fine */ }
                }
            }
        } else {
            data.unlockedApps = defaultApps;
        }
        // NuNu packaging: the home grid always shows the viewer's own apps (the Sys Admin tabs must not change it),
        // and on the GM's phone each app carries a tick when at least one player has it, ticked apps first.
        data.homeUnlockedApps = game.user.isGM ? (game.user.getFlag("VirtualAgent", "unlockedApps") || defaultApps) : data.unlockedApps;
        data.homeApps = data.allApps;
        if (game.user.isGM) {
            const lists = this._everyoneOwners().map((o) => o.getFlag("VirtualAgent", "unlockedApps") || defaultApps);
            for (const app of data.allApps) app.partyHas = lists.some((l) => l.includes(app.id));
            data.homeApps = [...data.allApps.filter((a) => a.partyHas), ...data.allApps.filter((a) => !a.partyHas)];
        }
        // NuNu packaging: the Operator app is its own file and sits outside Application Access:
        // it shows on the GM's phone and on the one player named in the Operator setting.
        const OP = globalThis.VirtualAgentOperator;
        data.operatorHtml = "";
        if (OP?.visible()) {
            data.homeApps = [OP.tile(), ...data.homeApps];
            data.homeUnlockedApps = [...data.homeUnlockedApps, "operator"];
            // A bad gig or stable record must not take the whole phone down with it.
            try { data.operatorHtml = OP.html(this); }
            catch (e) { console.error("Operator |", e); data.operatorHtml = `<div style="padding:30px 14px;text-align:center;color:#ff3366;font-size:.75rem;">Operator could not draw. See the console.</div>`; }
        }
        if (game.user.isGM && this._appLockPlayerUuid === "Everyone") {
            const owners = this._everyoneOwners();
            const lists = owners.map((o) => o.getFlag("VirtualAgent", "unlockedApps") || defaultApps);
            data.unlockedApps = lists.length ? defaultApps.filter((a) => lists.every((l) => l.includes(a))) : [];
        }
        data.appLockOwnerName = (appLockFlagOwner instanceof Actor)
            ? appLockFlagOwner.name
            : (appLockFlagOwner.id === game.user.id ? "GM (self)" : appLockFlagOwner.name);

        // Patch4 round 2: tabs are now scoped to the Application Access section
        // only — they drive `_appLockPlayerUuid`, NOT `selectedAdminActorUuid`.
        // GM identity / wallet view / transfer source are not affected by tab
        // clicks here. First tab is always "GM (self)" (the GM's own flags);
        // remaining tabs are each non-GM user.
        if (game.user.isGM) {
            const _adminTabs = [];
            _adminTabs.push({
                uuid: "VirtualWallet",
                name: "GM (self)",
                actorName: null,
                isGM: true,
                isActive: (this._appLockPlayerUuid === "VirtualWallet" || !this._appLockPlayerUuid)
            });
            // NuNu packaging: one tab that toggles an app for every phone at once (GM included).
            _adminTabs.push({
                uuid: "Everyone",
                name: "Party",
                actorName: null,
                isGM: false,
                isAll: true,
                isActive: this._appLockPlayerUuid === "Everyone"
            });
            for (const u of game.users.filter(x => !x.isGM)) {
                const identity = this._getIdentity(u);
                if (!identity || identity === "VirtualWallet" || identity.startsWith("User.")) {
                    _adminTabs.push({
                        uuid: `User.${u.id}`,
                        name: VA_displayName(u),
                        actorName: null,
                        isGM: false,
                        noActor: true,
                        isActive: this._appLockPlayerUuid === `User.${u.id}`
                    });
                    continue;
                }
                const playerActor = this._resolveActor(identity);
                _adminTabs.push({
                    uuid: identity,
                    name: VA_displayName(u),
                    actorName: playerActor?.name || null,
                    isGM: false,
                    isActive: this._appLockPlayerUuid === identity
                });
            }
            data.adminAppLockTabs = _adminTabs;

            // Patch4.7 (Gotto): wallet identity tabs. Lets the GM swap into a
            // player's wallet view from Sys Admin (the previous tabs only
            // scoped Application Access, not wallet). Same shape as the
            // app-access tabs so the existing CSS layout reuses cleanly.
            const _walletTabs = [];
            const activeWalletUuid = this.selectedAdminActorUuid || "VirtualWallet";
            _walletTabs.push({
                uuid: "VirtualWallet",
                name: "System Fund (Master)",
                actorName: null,
                isGM: true,
                isActive: activeWalletUuid === "VirtualWallet"
            });
            for (const u of game.users.filter(x => !x.isGM)) {
                const identity = this._getIdentity(u);
                if (!identity || identity === "VirtualWallet" || identity.startsWith("User.")) continue;
                const playerActor = this._resolveActor(identity);
                _walletTabs.push({
                    uuid: identity,
                    name: VA_displayName(u),
                    actorName: playerActor?.name || null,
                    isGM: false,
                    isActive: activeWalletUuid === identity
                });
            }
            data.adminWalletTabs = _walletTabs;

            // Patch4.7 (Gotto): per-player Trauma Team coverage + Fixer rank.
            // Patch5.5.19 (Phil Sweet): housing is now per-CHARACTER. The roster
            // iterates each player's owned character actors so a player running
            // multiple chars gets one row per character. TT coverage + Fixer rank
            // stay per-user.
            data.adminTtCoverage = [];
            data.adminHousingRoster = [];
            for (const u of game.users.filter(uu => !uu.isGM)) {
                const handle = VA_displayName(u);
                data.adminTtCoverage.push({
                    userId: u.id,
                    name: handle,
                    tier: u.getFlag("VirtualAgent", "ttCoverage") || "",
                    fixerRank: Number(u.getFlag("VirtualAgent", "fixerRank")) || 0
                });
                // Find this user's character actors. Foundry: ownership.<userId> >= 3 = owner.
                const ownedActors = game.actors.filter(a => {
                    const lvl = a.ownership?.[u.id];
                    return lvl !== undefined && lvl >= 3 && a.type !== 'mook' && a.type !== 'blackIce';
                });
                if (ownedActors.length === 0) {
                    // No character — legacy user-level housing only
                    data.adminHousingRoster.push({
                        ownerKind: 'user', ownerId: u.id, userId: u.id,
                        name: handle,
                        housingStatus: u.getFlag("VirtualAgent", "housingStatus") || "",
                        housingRent: u.getFlag("VirtualAgent", "housingRent") || "",
                        lifestyle: u.getFlag("VirtualAgent", "lifestyle") || ""
                    });
                } else {
                    for (const a of ownedActors) {
                        data.adminHousingRoster.push({
                            ownerKind: 'actor', ownerId: a.id, userId: u.id, actorUuid: a.uuid,
                            name: `${handle} → ${a.name}`,
                            housingStatus: a.getFlag("VirtualAgent", "housingStatus")
                                || u.getFlag("VirtualAgent", "housingStatus") || "",
                            housingRent: a.getFlag("VirtualAgent", "housingRent")
                                || u.getFlag("VirtualAgent", "housingRent") || "",
                            lifestyle: a.getFlag("VirtualAgent", "lifestyle")
                                || u.getFlag("VirtualAgent", "lifestyle") || ""
                        });
                    }
                }
            }
        } else {
            data.adminAppLockTabs = [];
            data.adminWalletTabs = [];
            data.adminTtCoverage = [];
        }

        const rawUnreads = game.user.getFlag("VirtualAgent", "unreads") || {};
        data.hideOnlineStatus = game.user.getFlag("VirtualAgent", "hideOnlineStatus") || false;

        // --- CONTACTS & MESSAGING ---
        data.contacts = this._getContacts();
        // 5.5.23: sort the Messages home list by most-recent activity
        // (newest thread on top), matching iOS / WhatsApp / Signal etc. Old
        // order was stable-by-insertion which made it hard to spot which
        // thread had a new message in a busy party. Computed via a single
        // O(messages) pass that buckets each AgentDevice message into the
        // contact it belongs to *from this user's perspective*. Ties (same
        // timestamp or both at 0) preserve original insertion order — keeps
        // the no-activity default reading as Party first, players next,
        // custom NPCs after.
        const _lastActivityByContact = {};
        try {
            const selfId = game.user.id;
            const isGmUser = game.user.isGM;
            for (const m of game.messages) {
                const f = m.flags?.VirtualAgent;
                if (!f?.isAgentMessage) continue;
                const tid = f.threadId;
                if (!tid) continue;
                const ts = m.timestamp || 0;
                let bucket = null;
                if (tid === "party_group_chat") {
                    bucket = "party_group_chat";
                } else if (String(tid).startsWith("pcgroup_") || String(tid).startsWith("npc_")) {
                    bucket = tid;
                } else {
                    // 1-to-1 PC DM: threadId is the recipient's user id.
                    // Bucket from this client's perspective:
                    //  - my outgoing message -> bucket = the other PC (threadId)
                    //  - incoming whispered to me -> bucket = the sender (author.id)
                    //  - GM monitoring -> bucket on threadId (the recipient PC)
                    const authorId = m.author?.id;
                    const w = Array.isArray(m.whisper) ? m.whisper : [];
                    if (authorId === selfId) {
                        bucket = tid;
                    } else if (w.includes(selfId)) {
                        bucket = authorId;
                    } else if (isGmUser) {
                        bucket = tid;
                    }
                }
                if (bucket && ts > (_lastActivityByContact[bucket] || 0)) {
                    _lastActivityByContact[bucket] = ts;
                }
            }
        } catch (e) {
            console.warn("[Virtual Agent] Messages home activity-sort scan failed:", e);
        }
        // Stable sort by descending activity (Array.sort is stable in V8/SM).
        data.contacts.sort((a, b) => {
            const ta = _lastActivityByContact[a.id] || 0;
            const tb = _lastActivityByContact[b.id] || 0;
            return tb - ta;
        });
        // NuNu packaging: the Messenger lists conversations, not the address book.
        // Only threads with something in them, plus the party channel and whichever
        // thread is open right now, so arriving from Contacts does not show an
        // empty list. Every contact still lives in the Contacts app.
        data.threads = data.contacts.filter((c) =>
            c.id === "party_group_chat"
            || (_lastActivityByContact[c.id] || 0) > 0
            || c.id === this.activeContactId);
        // Patch4.7 (Gotto Goho ghost-notification fix): the home-screen badge
        // used to sum Object.values(unreads), which includes orphan threadIds
        // left behind when a contact was deleted. Now we filter against the
        // current contacts list before summing — orphans contribute 0.
        // Patch4.7.1 (urgent): previously this also wrote a cleaned `unreads`
        // flag back via `setFlag` from inside getData. With Simple Calendar
        // running on an unpaused game, the SC `date-time-change` hook re-
        // renders the Agent multiple times per second, each render fired
        // a setFlag, which fired updateUser, which fired more renders. The
        // resulting thrash unbound click handlers faster than the user could
        // click them ("clicks unregistered while unpaused"). Display filter
        // is enough — orphans staying in the flag are invisible to the user.
        // Actual cleanup runs in the contact-delete handler (line ~1924).
        const validIds = new Set(data.contacts.map(c => c.id));
        const unreads = {};
        for (const [tid, n] of Object.entries(rawUnreads)) {
            if (validIds.has(tid)) unreads[tid] = n;
        }
        data.totalUnreads = Object.values(unreads).reduce((a, b) => a + b, 0);
        data.contacts.forEach(c => { c.unreads = unreads[c.id] || 0; });
        data.partyPlayers = game.users.filter(u => u.id !== game.user.id).map(u => {
            const identity = this._getIdentity(u);
            const actor = this._resolveActor(identity);
            return { id: u.id, name: VA_displayName(u), actorUuid: identity, actorName: actor?.name || null };
        });

        // Patch4 (Gotto Goho bug): GM used to auto-default to the FIRST PLAYER's
        // identity on initial open — which meant the GM's own wallet view showed
        // the first player's balance, not their own. Removed. GM now starts as
        // themselves (VirtualWallet) and explicitly switches into a player via
        // the new Sys Admin per-player tabs when they need to act as that player.
        if (game.user.isGM && this.selectedAdminActorUuid === null) {
            this.selectedAdminActorUuid = "VirtualWallet";
            data.selectedAdminActorUuid = "VirtualWallet";
        }

        const activeContact = data.contacts.find(c => c.id === this.activeContactId);
        data.activeContactName = activeContact ? activeContact.name : "Unknown Endpoint";
        // Patch2: surface group-chat flag so the template can show sender names
        // on every bubble (including the user's own), which players asked for
        // when reviewing the party feed.
        data.isGroupChat = !!(activeContact?.isGroup);

        // GM NPC identity indicator — show which NPC persona the GM is speaking as
        const isNpcThread = this.activeContactId?.startsWith("npc_");
        const isCustomGroupThread = !!(activeContact?.isCustomGroup);

        // Patch4.8.3 (player request): in a custom group thread with multiple
        // NPC members, the GM had no way to pick which NPC their messages came
        // from. They always sent as GM. Build a "speak as" picker option list
        // here — for single-NPC threads we keep the existing implicit behavior
        // (always that NPC). For multi-NPC group threads we expose every NPC
        // member plus a "GM (self)" entry. The picker writes to
        // `_gmSpeakingAsInThread[threadId]` so the choice sticks per-thread
        // while the app is open.
        this._gmSpeakingAsInThread = this._gmSpeakingAsInThread || {};
        data.gmGroupNpcVoices = [];
        if (game.user.isGM && isCustomGroupThread) {
            const members = Array.isArray(activeContact?.members) ? activeContact.members : [];
            // Look up each NPC member's contact metadata from any user's customContacts.
            const allCustomContacts = [];
            for (const u of game.users) {
                const list = u.getFlag("VirtualAgent", "customContacts") || [];
                for (const c of list) allCustomContacts.push(c);
            }
            const npcMembers = members
                .filter(m => m.startsWith("npc:"))
                .map(m => m.slice("npc:".length));
            const seen = new Set();
            const voices = [{ id: "gm", name: "GM (self)", avatar: "" }];
            for (const npcId of npcMembers) {
                if (seen.has(npcId)) continue;
                seen.add(npcId);
                const contact = allCustomContacts.find(c => c.id === npcId);
                voices.push({
                    id: npcId,
                    name: contact?.originalName || contact?.name || "Unknown NPC",
                    avatar: contact?.avatar || ""
                });
            }
            // Only meaningful if there are ≥2 NPCs (otherwise the single-NPC
            // path already implicitly speaks as that NPC).
            if (npcMembers.length >= 2) {
                data.gmGroupNpcVoices = voices;
                data.gmCurrentVoice = this._gmSpeakingAsInThread[this.activeContactId] || "gm";
            }
        }

        // SPEAKING AS label — for single-NPC threads (existing 4.7 behavior),
        // and for multi-NPC group threads when the GM has picked an NPC voice.
        if (game.user.isGM && isNpcThread && activeContact) {
            data.gmSpeakingAs = activeContact.originalName || activeContact.name;
        } else if (game.user.isGM && isCustomGroupThread && data.gmGroupNpcVoices.length > 0) {
            const cur = this._gmSpeakingAsInThread[this.activeContactId] || "gm";
            if (cur !== "gm") {
                const match = data.gmGroupNpcVoices.find(v => v.id === cur);
                data.gmSpeakingAs = match?.name || null;
            } else {
                data.gmSpeakingAs = null;
            }
        } else {
            data.gmSpeakingAs = null;
        }

        // Patch4 (Gotto Goho): when the GM is in an NPC thread, also surface
        // WHO the NPC is speaking TO. Previously only "SPEAKING AS: <persona>"
        // was shown, so the GM had to manually rename threads to remember the
        // intended recipient. Now we read the contact's `targetUserIds` and
        // resolve them to display names. Players don't need this (their POV
        // is implicit — the recipient is themselves).
        data.gmSpeakingTo = null;
        if (game.user.isGM && isNpcThread && activeContact) {
            const tList = Array.isArray(activeContact.targetUserIds) ? activeContact.targetUserIds : [];
            const owner = activeContact.ownerId ? [activeContact.ownerId] : [];
            const recipientIds = Array.from(new Set([...tList, ...owner]));
            const names = recipientIds
                .map(id => game.users.get(id))
                .filter(u => u && !u.isGM)
                .map(u => VA_displayName(u));
            if (names.length) data.gmSpeakingTo = names.join(", ");
        }

        // Patch4 (Ley): privacy indicator. Players were confused whether their
        // messages were private or visible to the whole table. Surface the
        // privacy mode clearly in the header so the user can tell at a glance.
        //   group         → visible to everyone (party chat)
        //   private       → 1-1 with another user (whisper only)
        //   npc-private   → player↔NPC (whispered to GMs, hidden from other players)
        //   npc-group     → GM acting as NPC, sent to multiple targets
        data.privacyMode = null;
        data.privacyLabel = null;
        if (this.activeContactId === 'party_group_chat') {
            data.privacyMode = "group";
            data.privacyLabel = "PARTY CHAT · EVERYONE READS";
        } else if (this.activeContactId?.startsWith("pcgroup_") || activeContact?.isCustomGroup) {
            // Patch4.8: custom group thread — readable by every member + GMs.
            data.privacyMode = "group";
            const memberCount = (activeContact?.members?.length || 0) + 1; // +1 for the creator
            data.privacyLabel = `GROUP CHAT · ${memberCount} MEMBERS + GM`;
        } else if (this.activeContactId && game.users.get(this.activeContactId)) {
            data.privacyMode = "private";
            const targetU = game.users.get(this.activeContactId);
            const targetName = targetU ? VA_displayName(targetU) : "recipient";
            // Patch4.7 (Gotto): tighten wording. Players were unsure whether
            // "PRIVATE · X only (GMs can read)" meant "ONLY X+GM can read" or
            // "X+GM plus maybe others". Explicit "ONLY YOU + " + recipient + " + GM" leaves no room.
            data.privacyLabel = `ONLY YOU + ${targetName} + GM`;
        } else if (isNpcThread) {
            // Patch5.0.1 (Gotto): if the NPC contact was distributed to
            // multiple PCs (GM ticked >1 box when creating), the thread
            // looks "private" but isn't — every other PC on `targetUserIds`
            // also receives the messages. Surface the co-recipients in the
            // label so nobody believes they're 1-to-1 when they aren't.
            const tList = Array.isArray(activeContact?.targetUserIds) ? activeContact.targetUserIds : [];
            const coRecipientIds = tList.filter(uid => uid !== game.user.id && !game.users.get(uid)?.isGM);
            const coNames = coRecipientIds
                .map(uid => game.users.get(uid))
                .filter(u => u)
                .map(u => VA_displayName(u));
            data.privacyMode = "npc-private";
            if (coNames.length > 0) {
                data.privacyLabel = `NPC CHANNEL · YOU + ${coNames.join(", ")} + GM`;
            } else {
                data.privacyLabel = "ONLY YOU + GM · NPC CHANNEL";
            }
        }

        // Group participants — surface who's actually on the channel so players
        // know who they're writing to. Beta4 feedback: group chat felt anonymous.
        data.activeParticipants = null;
        data.activeParticipantsLabel = null;
        if (activeContact?.isGroup && this.activeContactId === 'party_group_chat') {
            const participants = game.users
                .filter(u => u.active)
                .map(u => {
                    const idOver = u.getFlag("VirtualAgent", "idOverrides") || {};
                    // Patch4 round 6: same avatar fix as message bubbles —
                    // prefer character portrait over user profile pic.
                    const avatar = u.character?.img || u.avatar || "icons/svg/mystery-man.svg";
                    return {
                        id: u.id,
                        name: idOver.handle || u.character?.name || u.name,
                        isSelf: u.id === game.user.id,
                        isGM: u.isGM,
                        avatar: avatar,
                        color: u.color || null
                    };
                })
                // Stable order: self first, then GMs, then alphabetical.
                .sort((a, b) => {
                    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1;
                    if (a.isGM !== b.isGM) return a.isGM ? -1 : 1;
                    return a.name.localeCompare(b.name);
                });
            data.activeParticipants = participants;
            data.activeParticipantsLabel = participants.map(p => p.name).join(", ");
        }

        // Message Thread Resolution
        if (this.activeContactId) {
            // Patch5.0.1 (Gotto): tightened thread matching to prevent bleed
            // between threads. Custom group threads, NPC threads, and party
            // chat now use EXACT threadId match only — no whisper-based
            // fallback. The whisper fallback is only for 1-to-1 DM threads
            // (legacy compat) and is gated so it can't bleed pcgroup_*,
            // npc_*, or 'party_group_chat' messages into the wrong view.
            const isPcGroupThread = this.activeContactId.startsWith("pcgroup_");
            const isNpcThreadView = this.activeContactId.startsWith("npc_");
            const isPartyChatView = this.activeContactId === 'party_group_chat';
            data.messages = game.messages.filter(m => {
                // 1.7.3: also read the legacy AgentDevice namespace. The module id
                // renamed AgentDevice -> VirtualAgent in 1.1.0, but the message-SEND
                // path kept writing flags under `AgentDevice` while every reader moved
                // to `VirtualAgent` — so messages existed (visible in Foundry's sidebar)
                // but never matched this filter and threads rendered empty. Writes are
                // fixed to VirtualAgent now; this fallback surfaces anything created
                // under the old namespace before the fix.
                const flags = m.flags?.VirtualAgent || m.flags?.AgentDevice;
                if (!flags?.isAgentMessage) return false;
                // Strict-match views: exact threadId only.
                if (isPartyChatView)  return flags.threadId === 'party_group_chat';
                if (isPcGroupThread)  return flags.threadId === this.activeContactId;
                if (isNpcThreadView)  return flags.threadId === this.activeContactId;
                // 1-to-1 DM view: activeContactId is a user id.
                // 5.5.22 (CommanderCrunch69 privacy bug): the threadId match
                // used to be `flags.threadId === this.activeContactId` with
                // no author/whisper gate. Senders set threadId = recipient's
                // user.id, so any third-party PC viewing their own thread
                // with the same recipient matched here and leaked the DM.
                // Foundry pushes ChatMessage docs to every client regardless
                // of whisper visibility, so `game.messages.filter()` saw
                // them on uninvolved clients. Restricted to outgoing (author
                // === self) only. The whisper fallback below handles the
                // incoming branch with proper visibility checks.
                if (flags.threadId === this.activeContactId && m.author?.id === game.user.id) return true;
                if (m.whisper && m.whisper.length > 0) {
                    if (flags.threadId && flags.threadId.startsWith('npc_')) return false;
                    if (flags.threadId && flags.threadId.startsWith('pcgroup_')) return false;
                    if (flags.threadId === 'party_group_chat') return false;
                    if (m.whisper.includes(this.activeContactId) && m.author?.id === game.user.id) return true;
                    if (m.whisper.includes(game.user.id) && m.author?.id === this.activeContactId) return true;
                }
                return false;
            })
            // 1.7.4 — sort the thread chronologically. game.messages is a Collection in
            // insertion/DB order, which is NOT guaranteed to be timestamp order, and the
            // decoration pass below (day dividers, "consecutive" run-grouping, time gaps)
            // all assume ascending time. Without an explicit sort a thread can render out
            // of order — reported as a group chat "bringing the opener's messages to top".
            .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0))
            .map(m => {
                const realAuthorIsSelf = m.author?.id === game.user.id;
                const sender = m.author || game.users.find(u => u.name === m.alias);
                const flags = m.flags?.VirtualAgent || {};
                // NPC identity override — show NPC name + avatar instead of GM's
                // For player messages, prefer custom handle from Agent ID
                const authorHandleOverride = m.author ? (m.author.getFlag("VirtualAgent", "idOverrides")?.handle || "") : "";
                const displayName = flags.overrideName || authorHandleOverride || m.alias || m.author?.name || "Unknown";
                // Patch4 round 6 (CommanderCrunch69): PC avatars weren't showing
                // in group chat or PC→NPC threads because the fallback used
                // `User.avatar` (Foundry profile pic) which most players never
                // bother setting — so all bubbles fell to the default icon.
                // Now prefers the player's assigned CHARACTER portrait, which
                // is what the player actually identifies with at the table.
                // Patch4.7 (Gotto Goho follow-up): even with that fix, GMs were
                // STILL seeing default tokens for PCs. Root cause: `User#character`
                // returns the actor assigned in Foundry's user-management dialog,
                // which most groups never bother setting — they switch into their
                // PC in the agent's in-phone switcher instead. So `sender.character`
                // was null and we fell through to `user.avatar` (also unset) and
                // ended at the mystery-man default. Fix: also check the sender's
                // last-used Agent identity (`lastActorUuid` flag) and resolve that
                // actor's portrait. Fallback order: NPC override → user.character
                // → in-app PC identity → user profile pic → default icon.
                let senderCharImg = sender?.character?.img || "";
                if (!senderCharImg && sender) {
                    const senderAgentUuid = sender.getFlag?.("VirtualAgent", "lastActorUuid");
                    if (senderAgentUuid && senderAgentUuid !== "VirtualWallet") {
                        try {
                            const senderActor = this._resolveActor(senderAgentUuid);
                            if (senderActor?.img) senderCharImg = senderActor.img;
                        } catch (e) {}
                    }
                }
                // 5.5.22 (CommanderCrunch69): when an NPC bubble has no
                // overrideAvatar (player started the thread, GM's switchboard
                // contact has no image, etc.), try to resolve a same-named
                // world Actor's portrait before falling through to the
                // generic mystery-man icon. Cheap O(N actors) lookup; the
                // result is short-circuited if overrideAvatar already exists.
                let npcActorImg = "";
                if (!flags.overrideAvatar && flags.overrideName) {
                    const cleanNpcName = String(flags.overrideName)
                        .replace(/\s*\(via\s+[^)]+\)\s*$/i, "")
                        .trim();
                    if (cleanNpcName) {
                        try {
                            const npcActorMatch = game.actors?.find?.(a => a.name === cleanNpcName);
                            if (npcActorMatch?.img && npcActorMatch.img !== "icons/svg/mystery-man.svg") {
                                npcActorImg = npcActorMatch.img;
                            }
                        } catch (e) { /* lookup failed, fall through */ }
                    }
                }
                const displayAvatar = flags.overrideAvatar
                    || npcActorImg
                    || senderCharImg
                    || sender?.avatar
                    || "icons/svg/mystery-man.svg";

                // Patch4 round 6 (CommanderCrunch69 NPC avatar bug):
                // When the GM is in an NPC thread and sees their own NPC-mode
                // messages, those messages have `overrideAvatar` set to the
                // NPC's avatar. The old logic flagged them as `isSelf: true`
                // (because the real author IS the GM), and the template only
                // renders avatars on non-self bubbles — so the GM saw their
                // NPC bubbles on the right with no avatar, while players saw
                // them on the left WITH the NPC avatar. Two different views
                // of the same conversation.
                // Fix: when a message has `overrideAvatar` (i.e. it's a GM
                // roleplay message), treat it as "from the NPC" for layout
                // purposes — left-aligned, NPC avatar, NPC name. Persona-style
                // dialogue, matches what the player sees, makes the
                // conversation read correctly on both sides.
                // Patch5.5.4 audit catch: overrideName alone (voice override
                // with no avatar swap) was missed by the original check, so
                // the 5.5.3 isMultiPersonaThread flag never fired for those
                // threads. Broaden to either flag — any persona override
                // signals "this is an NPC bubble, treat as roleplay."
                const isNpcRoleplayMsg = !!(flags.overrideAvatar || flags.overrideName);
                const isSelf = isNpcRoleplayMsg ? false : realAuthorIsSelf;

                // Patch4.8: surface attachment metadata so the bubble template
                // can render the styled card instead of raw placeholder text.
                const att = flags.attachment;
                const attachment = (att && typeof att === 'object' && att.kind && att.desc)
                    ? { kind: String(att.kind), desc: String(att.desc), icon: att.kind === 'photo' ? 'fa-camera' : att.kind === 'video' ? 'fa-video' : 'fa-microphone' }
                    : null;

                // Patch5.0.1 (Gotto): voice-hash color for the sender name.
                // In multi-NPC group threads, players need to tell at a glance
                // which NPC just spoke. Hash the override name (or sender id)
                // to a stable hue and tint the sender label that color, so
                // each NPC voice reads visually distinct even when several
                // are rapid-fire texting in the same thread.
                let senderHue = 0;
                const hueSrc = String(flags.overrideName || displayName || "Unknown");
                for (let i = 0; i < hueSrc.length; i++) senderHue = (senderHue * 31 + hueSrc.charCodeAt(i)) % 360;
                const senderColor = `hsl(${senderHue}, 70%, 65%)`;

                // Patch5.5.3: personaKey distinguishes GM-puppeted NPCs from
                // each other. Without this, NPC1 / NPC2 / NPC1 all share the
                // GM's senderId, so the consecutive-message logic collapses
                // them into one run and hides avatars + speaker tags. The
                // key is "npc:<overrideName>" when a voice override is set,
                // otherwise it's the raw user id.
                const personaKey = flags.overrideName
                    ? `npc:${flags.overrideName}`
                    : `user:${m.author?.id}`;

                return {
                    id: m.id,
                    content: m.content,
                    sender: displayName,
                    senderColor,
                    senderId: m.author?.id,
                    personaKey,
                    isNpcRoleplay: isNpcRoleplayMsg,
                    isSelf: isSelf,
                    // Delete permission still tracks the real author so the
                    // GM can clean up their own NPC messages.
                    canDelete: realAuthorIsSelf || game.user.isGM,
                    timestamp: m.timestamp,
                    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                    avatar: displayAvatar,
                    attachment
                };
            });

            if (data.messages.length > 0) {
                const TWO_MIN = 2 * 60 * 1000;
                const FIVE_MIN = 5 * 60 * 1000;
                // Patch5.5.3: a thread is "multi-persona" if any message in it
                // used a GM voice override. Force-tag the speaker on every
                // bubble in multi-persona threads so players can attribute
                // each line without scrolling up to find the last name change.
                const isMultiPersonaThread = data.messages.some(m => m.isNpcRoleplay);
                let prevDayKey = null;
                for (let i = 0; i < data.messages.length; i++) {
                    const cur = data.messages[i];
                    const prev = i > 0 ? data.messages[i - 1] : null;
                    const next = data.messages[i + 1];
                    const dayKey = new Date(cur.timestamp).toDateString();
                    if (dayKey !== prevDayKey) {
                        cur.dayDivider = AgentOSApplication._formatDayDivider(cur.timestamp);
                        prevDayKey = dayKey;
                    }
                    // Patch5.5.3: consecutive checks personaKey, not senderId.
                    // GM-puppeted NPC1 → NPC2 → NPC1 used to collapse into one
                    // run (same GM senderId) and hide every avatar + speaker
                    // tag. personaKey differentiates them by override name.
                    cur.consecutive = !!prev
                        && prev.personaKey === cur.personaKey
                        && (cur.timestamp - prev.timestamp) < TWO_MIN
                        && !cur.dayDivider;
                    const isLastOfRun = !next
                        || next.personaKey !== cur.personaKey
                        || (next.timestamp - cur.timestamp) >= TWO_MIN;
                    const bigGapAfter = !next || (next.timestamp - cur.timestamp) >= FIVE_MIN;
                    cur.showTime = isLastOfRun || bigGapAfter;
                    // Patch2 + Patch5.5.3: show sender on every first-of-run
                    // bubble in group chats AND on EVERY bubble in multi-
                    // persona NPC threads (community feedback: "tag speaker
                    // every chat, if you're not going to make it obvious who
                    // it's from"). Self bubbles in solo threads stay clean.
                    cur.showSender = (data.isGroupChat && !cur.consecutive)
                        || (isMultiPersonaThread && !cur.isSelf);
                }
            }
        }

        data.typingPeer = this._currentTypingPeer();
        // Patch4.8 (player requests + "make it epic"): emoji picker rebuilt
        // into 6 categories with ~150 total. Cyberpunk-themed where possible,
        // explicit category for adult/rude reactions players were asking for.
        // Click a category tab → grid swaps to that category.
        data.emojiCategories = [
            { id: "react",  label: "REACT",  icon: "😎" },
            { id: "hands",  label: "HANDS",  icon: "🤘" },
            { id: "cyber",  label: "CYBER",  icon: "🤖" },
            { id: "combat", label: "COMBAT", icon: "🔫" },
            { id: "vibes",  label: "VIBES",  icon: "🔥" },
            { id: "nsfw",   label: "NSFW",   icon: "🍆" }
        ];
        data.emojiSets = {
            react:  ["😎","🤖","💀","😈","👿","🤡","🤢","🤮","💩","😱","😤","🥶","🥵","🤯","🫡","🫥","🤬","😡","🥲","😭","😏","🤤","🥴","🤐","🤫","🙄","😬","🥱","🫠","🫨","😵","💯","✅","❌","❗","❓"],
            hands:  ["👍","👎","✊","👊","🤜","🤛","🤞","🤟","🤘","✌️","🫰","🫵","🫴","🫳","🫲","🫱","🖕","🖖","🤙","👌","🤌","👏","🙌","🙏","💅","💪","🦾"],
            cyber:  ["🤖","💻","📱","📡","🛰️","🏙️","🌉","🚁","🛸","👾","🕹️","🎮","📟","💾","🔋","⚡","🦾","🦿","🧬","🧠","👁️","👁️‍🗨️","🩻","💉","🩸","🩼","🕶️","🥽","⚙️","🔧","🔨","🛠️","⚒️","⛓️","🪝","🪪","🔌","💿","📀"],
            combat: ["🔫","🔪","⚔️","🛡️","💣","🧨","🎯","🚔","🚨","🛎️","🥊","🥷","🦴","☠️","💀","🩸","🔥","💥","💢","☢️","☣️","⚠️","🚧"],
            vibes:  ["🔥","💯","💸","💰","💵","💴","💶","💷","💳","🪙","💎","🏧","🎰","🎲","🥃","🍾","🍻","🍺","🚬","💊","🌃","🌆","🌇","🌌","🎆","🎇","🎶","🎵","🎤","📸","✨","💫","⭐","🌟","💥","💣","🌀"],
            nsfw:   ["🍆","🍑","🥒","🌭","🍌","🍒","🍓","💦","👅","🫦","🖕","🍷","🥃","🚬","🩸","💀","🔥","😈","🥵","😏","💋","💍"]
        };
        // Default to "react"; user can click tabs to switch.
        this._emojiCategory = this._emojiCategory || "react";
        data.emojiCategory = this._emojiCategory;
        data.curatedEmojis = data.emojiSets[this._emojiCategory] || data.emojiSets.react;

        // --- NUNU MART (Store) ---
        data.storeView = this._storeView || 'list';
        const cart = this._getCart();
        data.storeCart = cart;
        data.storeCartCount = cart.reduce((s, e) => s + (Number(e.qty) || 0), 0);
        data.storeCartTotal = this._cartTotal(cart);
        const _storeQ = (this._storeSearch || "").toLowerCase();
        data.storeSearch = this._storeSearch || "";
        if (this._storeCatalog) {
            data.storeLoaded = true;
            // Patch5.5.13: prepend "All" as a virtual category at the front of the
            // tab strip. Default landing view shows every item across categories.
            data.storeCategories = ["All", ...Object.keys(this._storeCatalog).sort()];
            data.storeCategory = this._storeCategory || "All";
            const allItems = Object.values(this._storeCatalog).flat();
            const raw = (data.storeCategory === "All")
                ? allItems
                : (this._storeCatalog[data.storeCategory] || []);
            // When a search is active, broaden the result across ALL categories so
            // typing "ammo" while looking at Weapons still surfaces matches.
            const source = _storeQ ? allItems : raw;
            let storeResult = _storeQ
                ? source.filter(it => (it.name || "").toLowerCase().includes(_storeQ))
                : raw;
            // Affordability filter — compare against raw numeric balance
            if (this._storeFilterAffordable && data.actorCurrencyRaw !== undefined) {
                storeResult = storeResult.filter(it => it.price <= data.actorCurrencyRaw);
            }
            // Patch4.7 (Gotto): price-tier filter. Player picks a price BUCKET
            // (min..max range), not a max cap. The bucket model makes the
            // filter visibly change the result no matter the category — a max
            // cap of "≤1000 eb" on a Drugs page (all items 10-50eb) looked
            // identical to "all prices" and read as "the filter does nothing."
            // Now selecting "Costly" actually hides cheap items and only shows
            // 500-1000eb items.
            const priceTier = this._storePriceTier || "all";
            if (priceTier !== "all") {
                const bucket = this._priceBucketBounds(priceTier);
                if (bucket) {
                    storeResult = storeResult.filter(it => {
                        const p = Number(it.price) || 0;
                        return p >= bucket.min && p <= bucket.max;
                    });
                }
            }
            // Patch4.7 (Gotto): fixer-rank gate. GM sets a global "items above
            // X eb require Fixer rank ≥Y" pair. Each player has a `fixerRank`
            // flag. Items above the price threshold are hidden if the player
            // doesn't meet the rank threshold. GM bypasses the gate.
            if (!game.user.isGM) {
                const gatePrice = Number(game.settings.get("VirtualAgent", "storeFixerGatePrice")) || 0;
                const gateRank  = Number(game.settings.get("VirtualAgent", "storeFixerGateRank"))  || 0;
                const playerRank = Number(game.user.getFlag("VirtualAgent", "fixerRank")) || 0;
                if (gatePrice > 0 && gateRank > 0 && playerRank < gateRank) {
                    storeResult = storeResult.filter(it => Number(it.price) <= gatePrice);
                }
            }
            data.storeItems = storeResult;
            data.storeFilterAffordable = this._storeFilterAffordable;
            data.storePriceTier = priceTier;
            data.storePriceTiers = [
                { value: "all",     label: "All prices" },
                { value: "cheap",   label: "0–100 eb (Cheap)" },
                { value: "everyday",label: "100–500 eb (Everyday)" },
                { value: "costly",  label: "500–1,000 eb (Costly)" },
                { value: "premium", label: "1k–5k eb (Premium)" },
                { value: "expensive",label:"5k–10k eb (Expensive)" },
                { value: "luxury",  label: "10k+ eb (Luxury)" }
            ];
            const tierLabel = data.storePriceTiers.find(t => t.value === priceTier)?.label || priceTier;
            data.storePriceTierLabel = tierLabel;
        } else {
            data.storeLoaded = false;
            data.storeCategories = [];
            data.storeCategory = this._storeCategory;
            data.storeItems = [];
        }

        // --- ZIGGURAT DATAPOOL ---
        if (game.user.isGM) {
            // GM sees all shards across all users, tagged with owner info
            const allShards = [];
            for (const user of game.users) {
                const userShards = user.getFlag("VirtualAgent", "shards") || [];
                for (const s of userShards) {
                    allShards.push({ ...s, _ownerId: user.id, _ownerName: VA_displayName(user) });
                }
            }
            // Deduplicate by shard id (GM copy + player copy share same id)
            const seen = new Set();
            const deduped = [];
            for (const s of allShards) {
                const key = s.id + "_" + s._ownerId;
                if (!seen.has(key)) { seen.add(key); deduped.push(s); }
            }
            data.shards = deduped.filter(s =>
                s.name.toLowerCase().includes((this.shardSearchQuery || "").toLowerCase())
            ).sort((a,b) => b.timestamp - a.timestamp);
        } else {
            data.shards = (game.user.getFlag("VirtualAgent", "shards") || []).filter(s =>
                s.name.toLowerCase().includes((this.shardSearchQuery || "").toLowerCase())
            ).sort((a,b) => b.timestamp - a.timestamp);
        }

        data.activeShardName = this.activeShardName;
        data.activeShardContent = this.activeShardContent;

        // --- SATELLITE ENGINE SYNC ---
        data.mapZoom = this.mapZoom || 1;
        data.mapX = this.mapX || 0;
        data.mapY = this.mapY || 0;

        // --- STYLE CHECKER ---
        data.styleTab = this._styleTab || "outfit";
        if (actor instanceof Actor) {
            // Pull equipped items from CPR actor
            // CPR stores equipped state as a string: "equipped", "owned", or "carried".
            // Cyberware uses "installed" when slotted into the body.
            const items = actor.items?.contents || [];
            const _isEquipped = (i) => {
                const eq = String(i.system?.equipped || "").toLowerCase();
                return eq === "equipped" || eq === "installed" || i.system?.isEquipped === true;
            };
            // Gear tab — weapons, cyberware, armor, gear
            data.styleGear = items.filter(i => {
                const t = i.type?.toLowerCase() || "";
                return _isEquipped(i) && ['weapon', 'cyberware', 'armor', 'gear', 'clothing'].includes(t);
            }).map(i => ({
                name: i.name,
                type: i.type,
                img: i.img || "icons/svg/item-bag.svg",
                description: i.system?.description?.value || i.system?.description || "",
                equipped: true
            }));
            // Outfit tab — clothing + armor that's actually equipped
            data.styleOutfit = items.filter(i => {
                const t = i.type?.toLowerCase() || "";
                return _isEquipped(i) && ['clothing', 'armor'].includes(t);
            }).map(i => ({
                name: i.name,
                type: i.type,
                img: i.img || "icons/svg/item-bag.svg",
                style: i.system?.style || i.system?.description?.value || ""
            }));
            // Fashion score — based on equipped clothing count + cyberware
            const clothingCount = data.styleOutfit.length;
            const cyberCount = items.filter(i => i.type?.toLowerCase() === 'cyberware' && _isEquipped(i)).length;
            const baseScore = Math.min(clothingCount * 15, 60) + Math.min(cyberCount * 10, 30);
            const repBonus = Math.min(Math.floor(repScore / 10), 10);
            data.styleScore = Math.min(baseScore + repBonus, 100);
            data.styleRating = data.styleScore >= 80 ? "ICONIC" : data.styleScore >= 60 ? "EDGERUNNER" : data.styleScore >= 40 ? "STREETWISE" : data.styleScore >= 20 ? "BASIC" : "GONK";
            data.styleColor = data.styleScore >= 80 ? "#e040fb" : data.styleScore >= 60 ? "#64ffda" : data.styleScore >= 40 ? "#ffcc00" : "#ff5555";

            // Patch4.7 (Gotto): current trend + wardrobe modifier display.
            // Trend is world-level (set by GM via setting). Modifiers are
            // per-actor flag (`AgentDevice.wardrobeModifiers` = [{label, value}]).
            try {
                data.styleTrend = game.settings.get("VirtualAgent", "styleTrend") || "";
                data.styleTrendDesc = game.settings.get("VirtualAgent", "styleTrendDesc") || "";
            } catch (e) { data.styleTrend = ""; data.styleTrendDesc = ""; }
            const wm = (actor && actor.getFlag) ? (actor.getFlag("VirtualAgent", "wardrobeModifiers") || []) : [];
            data.styleWardrobeModifiers = Array.isArray(wm)
                ? wm.map(m => ({
                    label: String(m.label || m.name || "Modifier"),
                    value: Number(m.value) || 0,
                    positive: (Number(m.value) || 0) >= 0
                }))
                : [];
            data.showStyleInfo = !!this._showStyleInfo;
        } else {
            data.styleGear = [];
            data.styleOutfit = [];
            data.styleScore = 0;
            data.styleRating = "N/A";
            data.styleColor = "#555";
        }

        // --- CONTACTS ---
        // NuNu packaging: one source of truth. The book is the phone's own contact
        // list, the people this viewer actually has threads with. Role and standing
        // live in a world-scope map keyed by contact id, so they read the same for
        // everyone and survive a rename.
        let _contactMeta = {};
        try {
            const raw = game.settings.get("VirtualAgent", "contactMeta");
            _contactMeta = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {});
        } catch (e) { _contactMeta = {}; }
        data.contactMeta = _contactMeta;
        data.npcReputations = (data.contacts || [])
            .filter((c) => c.id !== "party_group_chat")
            .map((c) => ({
                id: c.id,
                name: c.name,
                avatar: c.avatar || null,
                isPlayer: !String(c.id).startsWith("npc_"),
                faction: _contactMeta[c.id]?.role || VA_roleOf(game.users.get(c.id)?.character) || "",
            }));

        // Patch3 (CommanderCrunch69): sort option for the Fixers app.
        // Standing → numeric weight so the "by attitude" sort groups allied first,
        // then friendly, neutral, hostile.
        const STANDING_WEIGHT = { allied: 0, friendly: 1, neutral: 2, hostile: 3 };
        const STANDING_LABEL  = { allied: "ALLIED", friendly: "FRIENDLY", neutral: "NEUTRAL", hostile: "HOSTILE" };
        const sortMode = this._repSort || "default";
        data.repSort = sortMode;
        if (Array.isArray(data.npcReputations) && data.npcReputations.length) {
            const arr = data.npcReputations.slice();
            if (sortMode === "alpha") {
                arr.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
            } else if (sortMode === "standing") {
                arr.sort((a, b) => {
                    const wa = STANDING_WEIGHT[a.standing] ?? 99;
                    const wb = STANDING_WEIGHT[b.standing] ?? 99;
                    if (wa !== wb) return wa - wb;
                    return String(a.name || "").localeCompare(String(b.name || ""));
                });
            } else if (sortMode === "faction") {
                arr.sort((a, b) => {
                    const fa = String(a.faction || "").toLowerCase();
                    const fb = String(b.faction || "").toLowerCase();
                    if (fa !== fb) return fa.localeCompare(fb);
                    return String(a.name || "").localeCompare(String(b.name || ""));
                });
            }
            data.npcReputations = arr;
        }
        data.repSortOptions = [
            { id: "default",  label: "Default order" },
            { id: "alpha",    label: "A → Z" },
            { id: "faction",  label: "By role" }
        ];

        // ════════════════════════════════════════════════════════════════════
        // Patch5.5: Black Chrome / All About Agents app data
        // ════════════════════════════════════════════════════════════════════

        // --- NCPD CRIME DATABASE (Black Chrome) ---
        try {
            const rawNcpd = game.settings.get("VirtualAgent", "ncpdRapSheets") || "[]";
            data.ncpdRapSheets = JSON.parse(rawNcpd);
            if (!Array.isArray(data.ncpdRapSheets)) data.ncpdRapSheets = [];
        } catch (e) { data.ncpdRapSheets = []; }
        // Search filter for the player-side list
        data.ncpdSearch = this._ncpdSearch || "";
        if (data.ncpdSearch) {
            const q = data.ncpdSearch.toLowerCase();
            data.ncpdRapSheetsView = data.ncpdRapSheets.filter(s =>
                String(s.name || "").toLowerCase().includes(q) ||
                String(s.charges || "").toLowerCase().includes(q) ||
                String(s.notes || "").toLowerCase().includes(q)
            );
        } else {
            data.ncpdRapSheetsView = data.ncpdRapSheets;
        }
        {
            // NuNu packaging: bounties and debt claims are two lists in one app.
            const view = data.ncpdRapSheetsView || [];
            data.bountyList = view.filter((r) => r.kind !== "debt");
            data.debtList = view.filter((r) => r.kind === "debt");
        }
        data.ncpdActiveId = this._ncpdActiveId || null;
        data.ncpdActiveRecord = data.ncpdActiveId
            ? data.ncpdRapSheets.find(s => s.id === data.ncpdActiveId) || null
            : null;

        // --- ZIGGURAT CITY DATABASE (Black Chrome) ---
        try {
            const rawZig = game.settings.get("VirtualAgent", "cityDirectoryEntries") || "[]";
            data.cityDirectory = JSON.parse(rawZig);
            if (!Array.isArray(data.cityDirectory)) data.cityDirectory = [];
        } catch (e) { data.cityDirectory = []; }
        // Patch5.5.15: unify filter categories with the add-dropdown list. Previously
        // these were two disjoint vocabularies (filter had "Venues/Bars/Food/Fixers/Black
        // Market/Services/Other"; add had "Venue/Fixer/Ripperdoc/Vendor/Safehouse/Gang
        // Turf/Corp/Other"), so saved entries never matched the filter chips. One list now.
        data.zigguratCategories = ["All", "Venue", "Fixer", "Ripperdoc", "Vendor", "Safehouse", "Gang Turf", "Corp", "Other"];
        data.zigguratCategory = this._zigguratCategory || "All";
        data.zigguratSearch = this._zigguratSearch || "";
        {
            let entries = data.cityDirectory;
            if (data.zigguratCategory && data.zigguratCategory !== "All") {
                entries = entries.filter(e => (e.category || "Other") === data.zigguratCategory);
            }
            if (data.zigguratSearch) {
                const q = data.zigguratSearch.toLowerCase();
                entries = entries.filter(e =>
                    String(e.name || "").toLowerCase().includes(q) ||
                    String(e.notes || "").toLowerCase().includes(q) ||
                    String(e.address || "").toLowerCase().includes(q)
                );
            }
            data.cityDirectoryView = entries;
        }

        // --- THE GARDEN (All About Agents) ---
        try {
            const rawGarden = game.settings.get("VirtualAgent", "gardenProfiles") || "[]";
            data.gardenProfiles = JSON.parse(rawGarden);
            if (!Array.isArray(data.gardenProfiles)) data.gardenProfiles = [];
        } catch (e) { data.gardenProfiles = []; }
        // Filter to profiles the GM has scoped to this player (or all if no scoping).
        if (!game.user.isGM) {
            data.gardenProfilesView = data.gardenProfiles.filter(p => {
                const targets = Array.isArray(p.targetUserIds) ? p.targetUserIds : [];
                return targets.length === 0 || targets.includes(game.user.id);
            });
        } else {
            data.gardenProfilesView = data.gardenProfiles;
        }
        data.gardenActiveId = this._gardenActiveId || null;
        // 1.8.0 — pending upload survives re-renders (the attach happens before submit)
        data.gardenPendingPhoto = this._gardenPendingPhoto?.label || null;
        data.gardenActiveProfile = data.gardenActiveId
            ? data.gardenProfiles.find(p => p.id === data.gardenActiveId) || null
            : null;

        // --- MAP INDICATORS (Ryouhi request) ---
        try {
            const rawPins = game.settings.get("VirtualAgent", "mapIndicators") || "[]";
            data.mapIndicators = JSON.parse(rawPins);
            if (!Array.isArray(data.mapIndicators)) data.mapIndicators = [];
        } catch (e) { data.mapIndicators = []; }
        // Only show indicators flagged visible (GM can hide while drafting).
        // GM always sees all pins (so they can manage hidden ones); players see only visible.
        data.mapIndicatorsView = game.user.isGM ? data.mapIndicators : data.mapIndicators.filter(p => p.isVisible !== false);
        // NuNu packaging: the party's position on the Sat Map, from the party marker token on the world-map scene.
        data.partyBlip = null;
        try {
            const wm = globalThis.VirtualAgentWorldMap?.scene();
            data.partyBlip = wm ? globalThis.VirtualAgentWorldMap.partyPos(wm) : null;
        } catch (e) { data.partyBlip = null; }
        // Patch5.5.5: GM add-content modal visibility (only ever true if GM).
        data.showNcpdAddModal = !!this.showNcpdAddModal && game.user.isGM;
        data.showZigguratAddModal = !!this.showZigguratAddModal && game.user.isGM;
        data.showGardenAddModal = !!this.showGardenAddModal;   // 1.6.0 — players can add too (write is GM-relayed)
        // Patch5.5.3: Maps app pin curation state (moved from Sys Admin).
        data.mapPinMode = !!this._mapPinMode && game.user.isGM;
        data.showMapPinModal = !!this.showMapPinModal && game.user.isGM;
        data.showMapPinManageModal = !!this.showMapPinManageModal && game.user.isGM;
        data.pendingPinX = Number(this._pendingPinX || 50).toFixed(1);
        data.pendingPinY = Number(this._pendingPinY || 50).toFixed(1);
        // Patch5.5.3 canon palette: pin colors map to recognizable CP RED factions
        // / threat tiers so the GM can color-code intent at a glance.
        data.mapPinColorPalette = [
            { value: '#3a86ff', label: 'AGPD' },        // law enforcement
            { value: '#ff003c', label: 'Trauma Team' }, // medical
            { value: '#cc0000', label: 'Arasaka' },     // corp red
            { value: '#ffcc00', label: 'Tyger Claws' }, // gang gold
            { value: '#00ffcc', label: 'Net / Data' },  // datapool cyan
            { value: '#7c4dff', label: 'Voodoo Boys' }, // gang violet
            { value: '#ff1493', label: 'Mox' },         // gang pink
            { value: '#44ff44', label: 'Aldecaldos' }   // nomad green
        ];
        data.mapPinIconPalette = [
            { value: 'fa-map-pin', label: 'Pin' }, { value: 'fa-skull', label: 'Skull' },
            { value: 'fa-biohazard', label: 'Bio' }, { value: 'fa-fire', label: 'Fire' },
            { value: 'fa-bolt', label: 'Bolt' }, { value: 'fa-crosshairs', label: 'Crosshairs' },
            { value: 'fa-star', label: 'Star' }, { value: 'fa-shield-alt', label: 'Shield' },
            { value: 'fa-question', label: 'Unknown' }, { value: 'fa-flag', label: 'Flag' },
            { value: 'fa-eye', label: 'Watcher' }, { value: 'fa-home', label: 'Safehouse' }
        ];

        // --- NIGHT MARKET (Gotto request) ---
        try {
            const rawNm = game.settings.get("VirtualAgent", "nightMarketActive") || "";
            data.nightMarket = rawNm ? JSON.parse(rawNm) : null;
            if (data.nightMarket && !Array.isArray(data.nightMarket.items)) data.nightMarket.items = [];
        } catch (e) { data.nightMarket = null; }
        data.nightMarketActive = !!(data.nightMarket && Array.isArray(data.nightMarket.items) && data.nightMarket.items.length > 0);
        // Patch5.5.6: "open" = market object exists (even if empty). "active" = has
        // items and shows the player tab. Splitting these lets the GM START an
        // empty market with a name before adding items, instead of the previous
        // implicit-start where adding the first item created the market.
        data.nightMarketOpen = !!data.nightMarket;
        // Player-side store mode. If Night Market closed, force back to catalog so the tab vanishes.
        if (!data.nightMarketActive && this._storeMode === "nightmarket") this._storeMode = "catalog";
        data.storeMode = this._storeMode || "catalog";
        // Patch5.5.12: surface catalog-loaded state so the Sys Admin picker can
        // render an explicit LOAD button when the catalog hasn't been imported yet
        // (NuNu Mart catalog only auto-loads when the GM opens the NuNu Mart app — Sys
        // Admin needs its own trigger).
        data.nmCatalogLoaded = !!this._storeCatalog;
        data.nmCatalogLoading = !!this._storeLoading;
        // GM-side curation picker: flatten the live catalog so the admin can browse + add.
        if (game.user.isGM && this._storeCatalog) {
            const picker = [];
            for (const cat of Object.keys(this._storeCatalog)) {
                for (const it of this._storeCatalog[cat]) {
                    picker.push({ uuid: it.uuid, name: it.name, price: it.price, img: it.img, category: cat });
                }
            }
            picker.sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
            data.nmCatalogPicker = picker.slice(0, 300); // hard cap to keep the panel lean
        } else {
            data.nmCatalogPicker = [];
        }

        // --- RENT / HOUSING (Gotto, old; Patch5.5.19 per-character per Phil Sweet) ---
        // Stored as actor flag now. Migration: if the actor flag is empty and
        // the user flag has a legacy value, fall through to the user flag.
        // Players with multiple characters can have different housing per char.
        const housingActor = (game.user.isGM && this._idViewTargetUserId)
            ? game.users.get(this._idViewTargetUserId)?.character
            : (actor instanceof Actor ? actor : game.user.character);
        const housingUser = (game.user.isGM && this._idViewTargetUserId)
            ? game.users.get(this._idViewTargetUserId)
            : game.user;
        data.housingStatus = housingActor?.getFlag?.("VirtualAgent", "housingStatus")
            || housingUser?.getFlag?.("VirtualAgent", "housingStatus") || "";
        data.housingRent = housingActor?.getFlag?.("VirtualAgent", "housingRent")
            || housingUser?.getFlag?.("VirtualAgent", "housingRent") || "";
        data.lifestyleName = housingActor?.getFlag?.("VirtualAgent", "lifestyle")
            || housingUser?.getFlag?.("VirtualAgent", "lifestyle") || "";
        data.lifestyleCost = VA_LIFESTYLE_COST[data.lifestyleName] || "";
        data.housingOptions = VA_HOUSING.map(([name, rent]) => ({ name, rent }));
        data.lifestyleOptions = VA_LIFESTYLE.map(([name, cost]) => ({ name, cost }));
        // Patch5.5.20: render block when EITHER field is set (was: only housingStatus).
        data.housingHasAny = !!(data.housingStatus || data.housingRent);

        // --- AUCTION HOUSE ---
        data.auctionView = this._auctionView || "list";
        data.auctionDetailId = this._auctionDetailId;
        try {
            // Optimistic UI: use pending data if available (avoids stale settings cache)
            let allAuctions;
            if (this._pendingAuctionData) {
                allAuctions = this._pendingAuctionData;
            } else {
                const rawAuctions = game.settings.get("VirtualAgent", "auctionListings");
                allAuctions = Array.isArray(rawAuctions) ? rawAuctions : (typeof rawAuctions === "string" && rawAuctions.trim() ? JSON.parse(rawAuctions) : []);
            }
            const now = Date.now();
            data.auctionListings = allAuctions.map(a => {
                const endTime = a.endTime || (a.createdAt + 86400000);
                const remaining = Math.max(0, endTime - now);
                const hours = Math.floor(remaining / 3600000);
                const minutes = Math.floor((remaining % 3600000) / 60000);
                const expired = remaining <= 0;
                const isHighBidder = a.highBidderId === game.user.id;
                return {
                    ...a,
                    timeLeft: expired ? "EXPIRED" : (hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m ${Math.floor((remaining % 60000) / 1000)}s`),
                    expired,
                    isHighBidder,
                    bidCount: a.bidCount || 0,
                    currentBid: a.currentBid || a.startingBid || 0
                };
            });
            if (this._auctionDetailId) {
                data.auctionDetail = data.auctionListings.find(a => a.id === this._auctionDetailId) || null;
            }
        } catch (e) { data.auctionListings = []; data.auctionDetail = null; }

        // ── 5.6.0 COMBAT app view-model ──────────────────────────────
        // FFXII-style menu state machine. Slice 1: MAIN screen with action
        // budget pips, status row, 7 placeholder buttons (only END TURN wired).
        // Slices 2-6 fill in attack/skill/item/defend/move/reload flows.
        try {
            const combat = game.combat;
            data.combatActive = !!(combat && combat.started);
            if (data.combatActive) {
                const currentCombatant = combat.combatant;
                const currentActor = currentCombatant?.actor || null;
                const myActor = (() => {
                    try { return game.user.character || canvas.tokens.controlled[0]?.actor || null; }
                    catch (e) { return null; }
                })();
                data.combatRound = combat.round || 1;
                data.combatTurnName = currentCombatant?.name || '?';
                data.combatTurnInitiative = currentCombatant?.initiative ?? null;
                data.combatIsMyTurn = !!(myActor && currentActor && myActor.id === currentActor.id);
                // 5.8.39: initiative roll from the phone. Find the combatant belonging to
                // the actor this Agent is bound to (fall back to myActor); if they're in
                // the tracker without an initiative yet, surface the ROLL INITIATIVE banner.
                try {
                    const _boundActor = this._resolveActor(this.actorUuid) || myActor;
                    const _myCbt = _boundActor
                        ? combat.combatants.find(c => c.actor?.id === _boundActor.id)
                        : null;
                    const _canRollInit = !!(_myCbt && (game.user.isGM ||
                        (_myCbt.actor?.testUserPermission?.(game.user, 'OWNER') ?? false)));
                    data.combatNeedsInitiative = !!(_myCbt && _myCbt.initiative == null && _canRollInit);
                    data.combatMyInitiative = _myCbt?.initiative ?? null;
                    this._myCombatantId = _myCbt?.id || null;
                    // 5.8.40: a GM runs many NPCs, so the single "my combatant" banner can't
                    // cover them. For GMs, suppress the single-roll banner and surface one that
                    // rolls every NPC combatant still missing initiative (NPC = no non-GM owner).
                    data.combatGmNeedsInitiative = false;
                    data.combatGmNpcInitCount = 0;
                    if (game.user.isGM) {
                        data.combatNeedsInitiative = false;
                        const _npcsNeedInit = combat.combatants.filter(c =>
                            c.initiative == null && !(c.players && c.players.length));
                        data.combatGmNpcInitCount = _npcsNeedInit.length;
                        data.combatGmNeedsInitiative = _npcsNeedInit.length > 0;
                    }
                } catch (e) { data.combatNeedsInitiative = false; data.combatGmNeedsInitiative = false; }
                // Action budget (placeholder until slice 5 wires real consumption tracking).
                // CPR has Move + Action (+ optional Bonus). Slice 1 shows all three available.
                const budgetState = this._combatBudget || { move: 'available', action: 'available', bonus: 'available' };
                data.combatBudget = {
                    move: budgetState.move,
                    action: budgetState.action,
                    bonus: budgetState.bonus,
                    moveAvailable: budgetState.move === 'available',
                    actionAvailable: budgetState.action === 'available'
                };
                // Status row — pulled live from the actor whose turn it is.
                const sys = currentActor?.system || {};
                const hp = sys.hp || sys.derivedStats?.hp || {};
                const hpVal = hp.value ?? hp.current ?? 0;
                const hpMax = hp.max ?? hp.maximum ?? 0;
                const hpPct = hpMax > 0 ? Math.round((hpVal / hpMax) * 100) : 0;
                data.combatStatus = {
                    name: currentActor?.name || '?',
                    hp: hpVal,
                    hpMax: hpMax,
                    hpPct: hpPct,
                    hpColor: hpPct >= 50 ? 'good' : hpPct >= 25 ? 'warn' : 'crit',
                    seriouslyWounded: hpMax > 0 && (hpVal <= hpMax / 2),
                    spBody: sys.externalData?.currentArmorBody?.value ?? sys.externalData?.armor?.body ?? 0,
                    spHead: sys.externalData?.currentArmorHead?.value ?? sys.externalData?.armor?.head ?? 0,
                    // 1.3.0 — mask this combatant's vitals when a player views an NPC and the GM hid them
                    vitalsHidden: this._hideVitalsFor(currentActor)
                };
                // 1.3.0 — global gate (used by the attack damage breakdown's armor-SP reveal)
                data.hideNpcVitals = this._npcVitalsHidden();
                // 5.6.0 menu state for the FFXII-style flow.
                data.combatMenuState = this._combatMenu || 'main';
                // 5.8.4: status cards render in upper viewport during MAIN and MORE both
                data.combatShowStatus = (data.combatMenuState === 'main' || data.combatMenuState === 'more');
                // 5.8.10 MORE action target picker viewmodel
                data.morePendingAction = this._morePendingAction;
                data.movePending = this._movePending ? {
                    ...this._movePending,
                    effectiveMax: this._movePending.isRun ? this._movePending.distanceMaxWithRun : this._movePending.distanceMax,
                    pctFilled: Math.round((this._movePending.distanceChosen / (this._movePending.isRun ? this._movePending.distanceMaxWithRun : this._movePending.distanceMax)) * 100)
                } : null;
                if (this._morePendingAction) {
                    try {
                        data.moreTargetsList = (canvas?.tokens?.placeables || [])
                            .filter(t => t.actor)
                            .map(t => ({
                                id: t.id, name: t.name || t.actor.name,
                                hp: t.actor.system?.derivedStats?.hp?.value ?? t.actor.system?.hp?.value ?? 0,
                                hpMax: t.actor.system?.derivedStats?.hp?.max ?? t.actor.system?.hp?.max ?? 0,
                                img: t.document?.texture?.src || t.actor.img,
                                vitalsHidden: this._hideVitalsFor(t.actor)
                            }));
                    } catch (e) { data.moreTargetsList = []; }
                }
                // 5.8.19 PERMISSIONS: GM always controls; players control on their own turn.
                // "Own turn" = user OWNS the current combatant's actor OR its token (covers unlinked tokens).
                // Don't require game.user.character match — many players never assign a character.
                const _isGM = game.user?.isGM ?? false;
                let _ownsCombatant = false;
                try {
                    if (currentActor?.testUserPermission) {
                        _ownsCombatant = currentActor.testUserPermission(game.user, 'OWNER');
                    }
                    // Fallback: check the token's permissions (unlinked tokens override actor perms)
                    if (!_ownsCombatant && currentCombatant?.token?.testUserPermission) {
                        _ownsCombatant = currentCombatant.token.testUserPermission(game.user, 'OWNER');
                    }
                    // Legacy char-assignment fallback (kept as a third path so old setups still work)
                    if (!_ownsCombatant) {
                        const _myCharId = game.user?.character?.id ?? null;
                        const _combatantId = currentActor?.id ?? null;
                        if (_myCharId && _combatantId && _myCharId === _combatantId) _ownsCombatant = true;
                    }
                } catch (e) { console.warn('[AgentDevice 5.8.19] perm check failed:', e); }
                data.combatCanControl = _isGM || _ownsCombatant;
                data.combatIsGM = _isGM;
                console.log('[AgentDevice 5.8.19] perm:',
                    'isGM=', _isGM,
                    'ownsCombatant=', _ownsCombatant,
                    'combatCanControl=', data.combatCanControl,
                    'currentActor=', currentActor?.name,
                    'user=', game.user?.name);
                // 5.8.0: contextual header suffix shown after "COMBAT" label when in sub-flow.
                if (this._combatMenu === 'attack') {
                    const phaseLabel = { weapon: 'WEAPON', target: 'TARGET', roll: 'ROLL', damage: 'DAMAGE', result: 'RESULT' }[this._attackPhase] || '';
                    data.combatHeaderSuffix = ` // ATTACK${phaseLabel ? ' · ' + phaseLabel : ''}`;
                } else if (this._combatMenu === 'item') {
                    data.combatHeaderSuffix = ` // ITEM${this._itemPhase === 'result' ? ' · USED' : ''}`;
                } else if (this._combatMenu === 'more') {
                    data.combatHeaderSuffix = this._morePendingAction
                        ? ` // MORE · ${this._morePendingAction.toUpperCase()} · TARGET`
                        : ` // MORE`;
                } else {
                    data.combatHeaderSuffix = '';
                }
                if (this._movePending) {
                    data.combatHeaderSuffix = ' // MOVE · DISTANCE';
                }
                // 5.8.17 viewport split: give the lower viewport more room in sub-flows
                if (this._attackRollPrep || this._skillRollPrep) {
                    data.upperFlex = '3 1 0';   // prep dialog needs maximum room
                    data.lowerFlex = '7 1 0';
                } else if (this._combatMenu === 'attack' || this._combatMenu === 'item') {
                    data.upperFlex = '4 1 0';   // weapon/target/item picker — lower has the list
                    data.lowerFlex = '6 1 0';
                } else {
                    data.upperFlex = '6 1 0';   // main / more — upper has status block
                    data.lowerFlex = '4 1 0';
                }
                // 5.8.15: attack/item vm moved INTO COMBAT block (was wrongly inside SKILLS-myActor block — GM has myActor=null so it skipped)
                data.attackPhase       = this._attackPhase || 'weapon';
                data.attackWeaponsList = [];
                data.attackTargetsList = [];
                data.attackHasWeapons  = false;
                data.attackHasTargets  = false;
                data.attackWeaponSelected = null;
                data.attackTargetSelected = null;
                data.attackRollResult  = null;
                data.attackDamageResult = null;
                data.attackAutoRange   = null;
                data.attackAutoDV      = null;
                data.attackDVBand      = null;
                data.attackDiagInfo    = '';
                data.combatItemsList   = [];
                data.combatItemsHas    = false;
                data.combatItemPhase   = this._itemPhase || 'pick';
                data.combatItemResult  = this._itemResult;

                // 5.8.16: hoist combatActor out of inner try — code after the catch (upper-viewport vm) references it
                const combatActor = currentActor || actor || null;
                try {
                console.log('[AgentDevice 5.8.16] attack vm starting');
                console.log('[AgentDevice 5.8.16] combatActor:', combatActor?.name || 'NULL', combatActor?.id);
                let _allItems = [];
                if (combatActor && combatActor.items) {
                    for (const it of combatActor.items) _allItems.push(it);
                    console.log('[AgentDevice 5.8.16] items collected:', _allItems.length, _allItems.map(i => i.type+':'+i.name).slice(0,10));
                }
                const wepItems = _allItems.filter(it => it && it.type === 'weapon');
                console.log('[AgentDevice 5.8.16] weapons after filter:', wepItems.length);
                const _diagInfo = combatActor
                    ? ('Actor: ' + (combatActor.name || '?') + ' · Items: ' + _allItems.length + ' · Weapons: ' + wepItems.length)
                    : 'No active actor';
                data.attackWeaponsList = wepItems.map(w => {
                    const mag = w.system?.magazine || {};
                    const magVal = mag.value ?? mag.current ?? null;
                    const magMax = mag.max ?? null;
                    // 5.8.22: a weapon "uses ammo" only if it has a configured magazine.max > 0.
                    // Melee weapons leave magazine null/empty → never marked unloaded.
                    const _wt = String(w.system?.weaponType || '').toLowerCase();
                    const _isBowCrossbow = (_wt === 'bow' || _wt === 'crossbow');
                    const usesAmmo = Number(magMax) > 0 && !_isBowCrossbow;  // 5.8.29: bows/crossbows reload as part of attack
                    const isUnloaded = usesAmmo && Number(magVal ?? 0) <= 0;
                    return {
                        id: w.id,
                        name: w.name,
                        damage: w.system?.damage || '?d6',
                        weaponType: w.system?.weaponType || '',
                        ammoCurrent: magVal ?? '—',
                        ammoMax: magMax ?? '—',
                        attackMod: w.system?.attackmod ?? 0,
                        skillName: w.system?.weaponSkill || w.system?.skill || '',
                        usesAmmo,
                        isUnloaded
                    };
                });
                data.attackHasWeapons = data.attackWeaponsList.length > 0;
                data.attackDiagInfo = _diagInfo;  // 5.8.11 — surfaced in empty-state template
                // Targets list: canvas tokens with a different actor + non-zero HP.
                try {
                    const myTokenId = canvas?.tokens?.placeables?.find(t => t.actor?.id === combatActor?.id)?.id;
                    data.attackTargetsList = (canvas?.tokens?.placeables || [])
                        .filter(t => t.actor && combatActor && t.actor.id !== combatActor.id)
                        .filter(t => {
                            // 5.8.24: if we can't see HP (no observer perm), assume alive — don't hide
                            // other-player tokens from the target picker just because we lack visibility.
                            const _hp = t.actor.system?.derivedStats?.hp?.value ?? t.actor.system?.hp?.value;
                            if (_hp === undefined || _hp === null) return true;
                            return Number(_hp) > 0;
                        })
                        .map(t => ({
                            id: t.id,
                            name: t.name || t.actor.name,
                            hp: t.actor.system?.derivedStats?.hp?.value ?? t.actor.system?.hp?.value ?? 0,
                            hpMax: t.actor.system?.derivedStats?.hp?.max ?? t.actor.system?.hp?.max ?? 0,
                            img: t.document?.texture?.src || t.actor.img,
                            vitalsHidden: this._hideVitalsFor(t.actor)
                        }));
                    data.attackHasTargets = data.attackTargetsList.length > 0;
                } catch (e) { data.attackTargetsList = []; data.attackHasTargets = false; }
                // Phase + selected refs
                data.attackPhase   = this._attackPhase || 'weapon';
                data.attackWeaponSelected = this._attackWeapon
                    ? (data.attackWeaponsList.find(w => w.id === this._attackWeapon) || null)
                    : null;
                data.attackTargetSelected = this._attackTarget
                    ? (data.attackTargetsList.find(t => t.id === this._attackTarget) || null)
                    : null;
                data.attackRollResult   = this._attackRoll;
                data.attackDamageResult = this._attackDamage;
                // 5.7.0 ITEM viewmodels: list consumable-ish items (gear, drugs, ammo).
                const itemTypes = ['gear', 'drug', 'cyberware'];
                data.combatItemsList = (combatActor.items?.contents || [])
                    .filter(it => itemTypes.includes(it.type) && ((it.system?.amount ?? it.system?.quantity ?? 1) > 0))
                    .map(it => ({
                        id: it.id, name: it.name, type: it.type,
                        qty: it.system?.amount ?? it.system?.quantity ?? 1,
                        img: it.img
                    }));
                data.combatItemsHas = data.combatItemsList.length > 0;
                data.combatItemPhase = this._itemPhase || 'pick';
                data.combatItemResult = this._itemResult;
                } catch (_attackVmErr) { console.warn('[AgentDevice 5.8.16] attack vm threw:', _attackVmErr); }
                // ── 5.7.1 upper-viewport viewmodels ──
                if (!this._attackTarget && game.user?.targets?.size === 1) {
                    const t = Array.from(game.user.targets)[0];
                    if (t && t.id) this._attackTarget = t.id;
                }
                const myToken = canvas?.tokens?.placeables?.find(t => t.actor?.id === combatActor?.id) || null;
                let autoDV = null, autoRange = null, dvBandLabel = null;
                if (this._attackWeapon && this._attackTarget && myToken) {
                    const tgtToken = canvas?.tokens?.get(this._attackTarget);
                    const wep = combatActor?.items.get(this._attackWeapon);
                    if (tgtToken && wep) {
                        try {
                            autoRange = Math.round(canvas.grid.measureDistance(myToken.center, tgtToken.center));
                            // 5.8.2 CPR Range Table pg 173: 8 bands, no Point Blank
                            const bands = [6, 12, 25, 50, 100, 200, 400, 800];
                            const bandLabels = ['0-6m', '7-12m', '13-25m', '26-50m', '51-100m', '101-200m', '201-400m', '401-800m'];
                            const bandIdx = bands.findIndex(b => autoRange <= b);
                            if (bandIdx >= 0) {
                                dvBandLabel = bandLabels[bandIdx];
                                const dvTable = wep.system?.dvTable;
                                if (Array.isArray(dvTable) && dvTable[bandIdx] !== undefined) {
                                    autoDV = Number(dvTable[bandIdx]) || null;
                                }
                            }
                        } catch (e) {}
                    }
                }
                data.attackAutoRange = autoRange;
                data.attackAutoDV    = autoDV;
                data.attackDVBand    = dvBandLabel;
                if (data.attackTargetSelected) {
                    const hp = data.attackTargetSelected.hp || 0;
                    const max = data.attackTargetSelected.hpMax || 1;
                    data.attackTargetSelected.hpPct = Math.max(0, Math.min(100, Math.round((hp / max) * 100)));
                    data.attackTargetSelected.hpColor = hp / max < 0.25 ? 'crit' : (hp / max < 0.5 ? 'warn' : 'good');
                }
                if (data.attackWeaponSelected) {
                    const wep = combatActor?.items?.get(this._attackWeapon);
                    if (wep) {
                        const skName = wep.system?.weaponSkill || wep.system?.skill || '';
                        const skItem = combatActor?.items?.find(it => it.type === 'skill' &&
                            (it.name?.toLowerCase() === String(skName).toLowerCase()));
                        const skLvl = Number(skItem?.system?.level ?? 0);
                        const ref = Number(combatActor?.system?.stats?.ref?.value ?? 0);
                        data.attackWeaponSelected.skillSummary = `${skName} +${skLvl + ref}`;
                        data.attackWeaponSelected.dvTableStr = Array.isArray(wep.system?.dvTable)
                            ? wep.system.dvTable.join('/') : '';
                        data.attackWeaponSelected.rof = wep.system?.rof ?? wep.system?.rateOfFire ?? '';
                    }
                }
                data.lastCombatAction = this._lastCombatAction;
                // 5.8.8 attack-roll prep viewmodel
                if (this._attackRollPrep) {
                    const _act = (game.combat?.combatant?.actor) || combatActor;
                    const _luckMax = Number(_act?.system?.stats?.luck?.value ?? 0);
                    const _pre = this._attackRollPrep;
                    data.attackRollPrep = {
                        ..._pre,
                        luckMax: _luckMax,
                        modDisplay: (_pre.modifier >= 0 ? '+' : '') + _pre.modifier,
                        modIsNegative: _pre.modifier < 0,
                        modIsPositive: _pre.modifier > 0,
                        dvOverridden: _pre.dvOverride !== _pre.autoDV
                    };
                    // 1.4.0 — ammo-type picker viewmodel (buttons + the selected type's CPR rule note)
                    const _curAmmo = _pre.ammoType || 'basic';
                    data.attackRollPrep.ammoOptions = this._ammoTypeList().map(a => ({ key: a.key, label: a.label, active: a.key === _curAmmo }));
                    data.attackRollPrep.ammoNote = this._ammoRuleNote(_curAmmo);
                } else {
                    data.attackRollPrep = null;
                }
                const _statKeys = ['int', 'ref', 'dex', 'tech', 'cool', 'will', 'luck', 'move', 'body', 'emp'];
                data.charStats = _statKeys.map(k => ({
                    key: k.toUpperCase(),
                    val: Number(combatActor?.system?.stats?.[k]?.value ?? 0)
                })).filter(st => st.val > 0).slice(0, 5);
                data.charName = combatActor?.name;
                data.charImg  = combatActor?.img;
                // (1.8.3: the skill-prep viewmodel used to be built HERE — inside the
                // `if (combatActor && combatActor.items)` gate. It moved to the SKILLS
                // view-model below; see the root-cause note there.)

            }
            data.combatGamification = (() => {
                try { return game.settings.get('VirtualAgent', 'combatGamification') || 'full'; }
                catch (e) { return 'full'; }
            })();
            if (!data.upperFlex) { data.upperFlex = '6 1 0'; data.lowerFlex = '4 1 0'; }
        } catch (e) {
            console.warn('[Virtual Agent] COMBAT view-model failed:', e);
            data.combatActive = false;
        }

        // ── 5.6.0 SKILLS app view-model ──────────────────────────────
        // Standalone skill picker — separate tile from COMBAT per user
        // direction. Shows all trained skills sorted by stat × LVL desc.
        // Slice 3 will wire actual rolling; slice 1 just lists.
        try {
            // 1.8.3 ROOT-CAUSE FIX ("skills clicks don't roll", finally): the prep-dialog
            // viewmodel (data.skillRollPrep) was built inside the COMBAT block's
            // `if (combatActor && combatActor.items)` gate. combatActor comes from the
            // combat/token context — so for a player with no active combatant and no
            // selected token, tapping a skill SET this._skillRollPrep and re-rendered,
            // but the viewmodel never reached the template: the list re-rendered instead
            // of the prep panel, silently, forever. GMs almost always have a token
            // selected, which is why it never reproduced for them. skillRollPrep /
            // skillRollHistory / skillsShrunk are consumed ONLY by the skills view, so
            // they are built here, gated on nothing but the prep state itself.
            data.skillRollHistory = (this._skillRollHistory || []).slice(0, 3);
            data.skillsShrunk     = this._skillsShrunk;
            if (this._skillRollPrep) {
                const _luckMax = Number(this._resolveSkillsActor()?.system?.stats?.luck?.value ?? 0);
                const _pre = this._skillRollPrep;
                data.skillRollPrep = {
                    ..._pre,
                    luckMax: _luckMax,
                    baseTotal: _pre.stat + _pre.lvl,
                    finalTotal: _pre.stat + _pre.lvl + _pre.modifier + _pre.luckSpent,
                    modIsNegative: _pre.modifier < 0,
                    modIsPositive: _pre.modifier > 0,
                    modDisplay: (_pre.modifier >= 0 ? '+' : '') + _pre.modifier
                };
            } else {
                data.skillRollPrep = null;
            }
            const myActor = this._resolveSkillsActor();
            if (myActor) {
                const sys = myActor.system || {};
                const skillItems = myActor.items?.filter(i => i.type === 'skill') || [];
                const stats = sys.stats || {};
                data.skillsActorName = myActor.name;
                data.skillsList = skillItems.map(sk => {
                    const stat = sk.system?.stat || sk.system?.statName || '';
                    const lvl = sk.system?.level ?? sk.system?.value ?? 0;
                    const statVal = stats[stat]?.value ?? 0;
                    const modifier = statVal + lvl;
                    return {
                        id: sk.id,
                        name: sk.name,
                        statKey: stat,                          // raw key for actor.system.stats lookup at roll time
                        stat: (stat || '').toUpperCase(),
                        lvl, statVal, modifier,
                        modSign: modifier >= 0 ? '+' : ''
                    };
                }).sort((a, b) => b.modifier - a.modifier);
                data.skillsHasList = data.skillsList.length > 0;
                // 5.6.1: expose search state so input keeps value across re-renders.
                data.skillsSearch = this._skillSearch || '';
                if (this._skillRollPrep) {
                    data.skillsUpperFlex = '3 1 0';
                    data.skillsLowerFlex = '7 1 0';
                } else {
                    // 1.1.2: the character card up top is fixed-height — size it to its content
                    // and hand ALL remaining height to the skills list (the selector). Was a 6/4
                    // split that pinned the list to 40% (and overrode the post-roll shrink CSS).
                    data.skillsUpperFlex = '0 0 auto';
                    data.skillsLowerFlex = '1 1 auto';
                }
            } else {
                data.skillsActorName = '';
                data.skillsList = [];
                data.skillsHasList = false;
            }
        } catch (e) {
            console.warn('[Virtual Agent] SKILLS view-model failed:', e);
            data.skillsHasList = false;
            data.skillsList = [];
        }

        return data;
    }

    /* 5.7.0 gamification: floating damage / status pop. Slice 5 visual feedback.
       Reads the user's combatGamification setting and skips when set to off. */
    /* 5.8.25 CPR Critical Injury Tables — pg 187-188. Roll is 2d6 (NOT 1d10),
       results range 2-12. Body table is default; Head table used when Aimed Shot to head.
       Tables transcribed directly from CPR core. */
    static CPR_CRIT_INJURY_BODY = {
        2:  { name: 'Dismembered Arm',  effect: 'The Dismembered Arm is gone. Drop any items in that hand. Base Death Save Penalty +1.',  quickFix: 'N/A',                           treatment: 'Surgery DV17' },
        3:  { name: 'Dismembered Hand', effect: 'The Dismembered Hand is gone. Drop any items in that hand. Base Death Save Penalty +1.', quickFix: 'N/A',                           treatment: 'Surgery DV17' },
        4:  { name: 'Collapsed Lung',   effect: '-2 to MOVE (minimum 1). Base Death Save Penalty +1.',                                     quickFix: 'Paramedic DV15',                treatment: 'Surgery DV15' },
        5:  { name: 'Broken Ribs',      effect: 'End of every Turn you move further than 4m/yds on foot, re-suffer this CI\'s Bonus Damage.', quickFix: 'Paramedic DV13',           treatment: 'Paramedic DV15 or Surgery DV13' },
        6:  { name: 'Broken Arm',       effect: 'The Broken Arm cannot be used. Drop any items in that hand.',                            quickFix: 'Paramedic DV13',                treatment: 'Paramedic DV15 or Surgery DV13' },
        7:  { name: 'Foreign Object',   effect: 'End of every Turn you move further than 4m/yds on foot, re-suffer this CI\'s Bonus Damage.', quickFix: 'First Aid/Paramedic DV13', treatment: 'Quick Fix removes Injury Effect permanently' },
        8:  { name: 'Broken Leg',       effect: '-4 to MOVE (minimum 1)',                                                                 quickFix: 'Paramedic DV13',                treatment: 'Paramedic DV15 or Surgery DV13' },
        9:  { name: 'Torn Muscle',      effect: '-2 to Melee Attacks',                                                                    quickFix: 'First Aid/Paramedic DV13',      treatment: 'Quick Fix removes Injury Effect permanently' },
        10: { name: 'Spinal Injury',    effect: 'Next Turn no Action (Move Action still ok). Base Death Save Penalty +1.',                quickFix: 'Paramedic DV15',                treatment: 'Surgery DV15' },
        11: { name: 'Crushed Fingers',  effect: '-4 to all Actions involving that hand',                                                  quickFix: 'Paramedic DV13',                treatment: 'Surgery DV15' },
        12: { name: 'Dismembered Leg',  effect: 'The Dismembered Leg is gone. -6 to MOVE (min 1). Cannot dodge. Base Death Save Penalty +1.', quickFix: 'N/A',                       treatment: 'Surgery DV17' }
    };
    static CPR_CRIT_INJURY_HEAD = {
        2:  { name: 'Lost Eye',         effect: 'The Lost Eye is gone. -4 to Ranged Attacks & Perception Checks involving vision. Base Death Save Penalty +1.', quickFix: 'N/A',          treatment: 'Surgery DV17' },
        3:  { name: 'Brain Injury',     effect: '-2 to all Actions. Base Death Save Penalty +1.',                                                                quickFix: 'N/A',          treatment: 'Surgery DV17' },
        4:  { name: 'Damaged Eye',      effect: '-2 to Ranged Attacks & Perception Checks involving vision.',                                                    quickFix: 'Paramedic DV15', treatment: 'Surgery DV13' },
        5:  { name: 'Concussion',       effect: '-2 to all Actions',                                                                                             quickFix: 'First Aid/Paramedic DV13', treatment: 'Quick Fix removes Injury Effect permanently' },
        6:  { name: 'Broken Jaw',       effect: '-4 to all Actions involving speech',                                                                            quickFix: 'Paramedic DV13', treatment: 'Paramedic or Surgery DV13' },
        7:  { name: 'Foreign Object',   effect: 'End of every Turn you move further than 4m/yds on foot, re-suffer this CI\'s Bonus Damage.',                  quickFix: 'First Aid/Paramedic DV13', treatment: 'Quick Fix removes Injury Effect permanently' },
        8:  { name: 'Whiplash',         effect: 'Base Death Save Penalty +1.',                                                                                   quickFix: 'Paramedic DV13', treatment: 'Paramedic or Surgery DV13' },
        9:  { name: 'Cracked Skull',    effect: 'Aimed Shots to head multiply damage past SP by 3 instead of 2. Base Death Save Penalty +1.',                   quickFix: 'Paramedic DV15', treatment: 'Paramedic or Surgery DV15' },
        10: { name: 'Damaged Ear',      effect: 'If you moved further than 4m/yds on foot, no Move Action next Turn. -2 to Perception Checks involving hearing.', quickFix: 'Paramedic DV13', treatment: 'Surgery DV13' },
        11: { name: 'Crushed Windpipe', effect: 'You cannot speak. Base Death Save Penalty +1.',                                                                 quickFix: 'N/A',          treatment: 'Surgery DV15' },
        12: { name: 'Lost Ear',         effect: 'The Lost Ear is gone. If you moved >4m/yds on foot, no Move Action next Turn. -4 to Perception involving hearing. Base Death Save Penalty +1.', quickFix: 'N/A', treatment: 'Surgery DV17' }
    };

    /* 5.8.28: Roll Death Save for Mortally Wounded character (CPR pg 186).
       Death Save = BODY check vs DV10 + accumulated Death Save Penalty. Failing one = Dead.
       Death Save Penalty starts at 0, increases by 1 for certain Crit Injuries. */
    async _rollDeathSave({ actor }) {
        try {
            if (!actor) return;
            const body = Number(actor.system?.stats?.body?.value ?? 0);
            // 5.8.32: RAW rewrite (CPR pg 187, verbatim source-of-truth PDF). Roll 1d10
            // (NO explode) + Death Save Penalty. Strictly UNDER BODY = live. Natural 10
            // auto-fails. Each save rolled raises the penalty for the next by +1. The
            // penalty resets to Base (raised by some Crit Injuries) on Stabilization.
            const basePenalty = Number(actor.getFlag?.('VirtualAgent', 'deathSaveBasePenalty') ?? 0);
            const dsp = Number(actor.getFlag?.('VirtualAgent', 'deathSavePenalty') ?? basePenalty);
            const roll = new Roll('1d10');
            await roll.evaluate({ async: true });
            const nat = roll.dice?.[0]?.results?.[0]?.result ?? roll.total;
            const total = nat + dsp;
            const success = nat !== 10 && total < body;
            // pg 187: "Every time you roll a Death Save, your Death Save Penalty increases"
            try { await actor.setFlag?.('VirtualAgent', 'deathSavePenalty', dsp + 1); } catch (e) {}
            const _accent = success ? '#22ddff' : '#ff3366';
            const flavor = `<div style="font-family: monospace; padding: 12px 14px; background: rgba(5,5,16,0.95); border-left: 3px solid ${_accent}; border-radius: 3px; box-shadow: 0 0 14px ${_accent}40;">
              <div style="font-size: 1.0rem; color: ${_accent}; font-weight: 800; letter-spacing: 2px; text-shadow: 0 0 6px ${_accent}; margin-bottom: 6px;">${success ? '✓ DEATH SAVE — SUCCESS' : '☠ DEATH SAVE — FAILED'}</div>
              <div style="font-size: 0.7rem; color: #fff; margin-bottom: 8px;"><strong style="color:${_accent};">${actor.name}</strong> rolls <strong style="color:${_accent};">${nat}</strong>${dsp ? ` + ${dsp} penalty = <strong style="color:${_accent};">${total}</strong>` : ''} vs BODY ${body} <span style="color:#888;">(must roll under)</span></div>
              <div style="font-size: 0.65rem; color: #ccc;">1d10 + Death Save Penalty, under BODY = live · natural 10 always fails${nat === 10 ? ' — <strong style="color:#ff3366;">NATURAL 10</strong>' : ''} · next save at +${dsp + 1}</div>
              ${success
                ? '<div style="font-size: 0.6rem; color: #22ddff; margin-top: 6px;">Survives this turn — still Mortally Wounded, still bleeding out. Must save again next turn.</div>'
                : '<div style="font-size: 0.6rem; color: #ff3366; margin-top: 6px;">DEAD. (CPR pg 187 — one failed Death Save and you\'re gone.)</div>'}
              <div style="font-size: 0.58rem; color: #999; margin-top: 6px; font-style: italic;">CPR pg 187 · auto-prompted at start of Mortally Wounded turn</div>
            </div>`;
            await ChatMessage.create({ speaker: { alias: 'AgentDevice — Death Save' }, content: flavor, rolls: [roll], type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5 });
            console.log(`[AgentDevice 5.8.32] Death Save: ${actor.name} ${nat}+${dsp} vs BODY ${body} → ${success ? 'PASS' : 'DEAD'}`);
            // 1.5.2 — a failed Death Save = DEAD (CPR pg 187). Mark it so the start-of-turn auto-prompt
            // stops rolling fresh Death Saves for a corpse. `agentDead` is the gate the updateCombat
            // trigger reads; Foundry "defeated" shows the skull in the tracker. Cleared if HP returns >= 1.
            if (!success) {
                try { await actor.setFlag?.('VirtualAgent', 'agentDead', true); } catch (e) {}
                try {
                    const _cbt = game.combat?.combatants?.find(c => c.actor?.id === actor.id);
                    if (_cbt && !_cbt.isDefeated) await _cbt.update({ defeated: true });
                } catch (e) {}
            }
        } catch (e) {
            console.error('[AgentDevice 5.8.32] _rollDeathSave failed:', e);
        }
    }

    /* 5.8.25: Roll on Critical Injury Table + post chat card. Always called GM-side
       (either directly when GM is the attacker, or via socket when player attacks).
       Per CPR pg 187: roll 2d6 until you get one the target isn\'t already suffering. */
    async _rollCriticalInjury({ targetUuid, targetName, attackerName, location = 'body', forcedInjury = null, bumpDeathSavePenalty = false }) {
        try {
            const table = location === 'head'
                ? AgentOSApplication.CPR_CRIT_INJURY_HEAD
                : AgentOSApplication.CPR_CRIT_INJURY_BODY;
            // 5.8.28: re-roll if target already suffers the rolled injury (CPR pg 187). Max 6 re-rolls.
            let target = null;
            try { target = await fromUuid(targetUuid); } catch (e) {}
            // 5.8.32: damaged-while-Mortally-Wounded raises Death Save Penalty by 1 (pg 186).
            // Piggybacks here because mortal+damage always routes through the crit payload.
            if (bumpDeathSavePenalty && target) {
                try {
                    const _base = Number(target.getFlag?.('VirtualAgent', 'deathSaveBasePenalty') ?? 0);
                    const _cur = Number(target.getFlag?.('VirtualAgent', 'deathSavePenalty') ?? _base);
                    await target.setFlag?.('VirtualAgent', 'deathSavePenalty', _cur + 1);
                } catch (e) {}
            }
            const existingInjuries = (target?.items?.filter(it => it.type === 'criticalInjury') || [])
                .map(it => String(it.name || '').toLowerCase());
            let roll = null, total = null, entry, attempts = 0, rerollFlavor = '';
            if (forcedInjury) {
                // 5.8.32: Aimed Shot → Leg forces specifically Broken Leg (pg 169) — no table roll.
                entry = Object.values(table).find(e => String(e.name).toLowerCase() === String(forcedInjury).toLowerCase())
                    || { name: forcedInjury, effect: 'See rulebook.', quickFix: '?', treatment: '?' };
            } else {
            do {
                roll = new Roll('2d6');
                await roll.evaluate({ async: true });
                total = roll.total;
                entry = table[total] || { name: '?', effect: '?', quickFix: '?', treatment: '?' };
                attempts++;
                if (!existingInjuries.includes(String(entry.name).toLowerCase())) break;
                rerollFlavor += `<div style="font-size:0.55rem;color:#aaa;margin-top:2px;">re-roll: ${total} → ${entry.name} (already suffering)</div>`;
            } while (attempts < 6);
            }
            const dice = roll ? (roll.dice?.[0]?.results || []).map(r => r.result).join(' + ') : '';
            const _accent = '#ff3366';
            const flavor = `<div style="font-family: monospace; padding: 12px 14px; background: rgba(5,5,16,0.95); border-left: 3px solid ${_accent}; border-radius: 3px; box-shadow: 0 0 14px ${_accent}40;">
              <div style="font-size: 1.0rem; color: ${_accent}; font-weight: 800; letter-spacing: 2px; text-shadow: 0 0 6px ${_accent}; margin-bottom: 6px;">★ CRITICAL INJURY <span style="color:#888; font-size:0.6rem; letter-spacing:1px;">${location.toUpperCase()} TABLE</span></div>
              <div style="font-size: 0.7rem; color: #fff; margin-bottom: 8px;"><strong style="color:${_accent};">${targetName}</strong> suffers <strong style="color:${_accent};">${entry.name}</strong></div>
              <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; font-size: 0.6rem; margin-bottom: 8px;">
                <div style="padding: 5px 6px; background: rgba(255,51,102,0.06); border: 1px solid ${_accent}55; border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1px; white-space: nowrap; overflow: hidden;">${roll ? 'ROLL 2d6' : 'FORCED'}</div><div style="color:#fff; font-weight:700; font-size:0.95rem;">${roll ? `${total} <span style="color:#888; font-size:0.55rem;">(${dice})</span>` : '<span style="font-size:0.6rem;">Aimed Shot · Leg (pg 169)</span>'}</div></div>
                <div style="padding: 5px 6px; background: rgba(255,51,102,0.06); border: 1px solid ${_accent}55; border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1px; white-space: nowrap; overflow: hidden;">BONUS DMG</div><div style="color:#fff; font-weight:700; font-size:0.95rem;">+5 <span style="color:#888; font-size:0.55rem;">direct HP</span></div></div>
              </div>
              <div style="font-size: 0.6rem; color: #ddd; margin-bottom: 6px;"><strong style="color:${_accent};">Effect:</strong> ${entry.effect}</div>
              <div style="font-size: 0.65rem; color: #ccc;"><strong style="color:#fff;">Quick Fix:</strong> ${entry.quickFix} &nbsp;·&nbsp; <strong style="color:#fff;">Treatment:</strong> ${entry.treatment}</div>
              ${rerollFlavor}
              <div style="font-size: 0.58rem; color: #999; margin-top: 6px; font-style: italic;">CPR pg 187-188${roll ? ` · attempts: ${attempts}` : ' · forced by Aimed Shot'}</div>
            </div>`;
            await ChatMessage.create({
                speaker: { alias: 'AgentDevice' },
                content: flavor,
                ...(roll ? { rolls: [roll], type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5 } : {})
            });
            console.log(`[AgentDevice 5.8.25] Critical Injury for ${targetName}: ${roll ? `2d6=${total}` : 'forced'} → ${entry.name}`);
        } catch (e) {
            console.error('[AgentDevice 5.8.25] rollCriticalInjury failed:', e);
        }
    }

        _spawnDamagePop(kind, value) {
        try {
            const mode = game.settings.get('VirtualAgent', 'combatGamification');
            if (mode === 'off') return;
            if (mode === 'numbers-only' && /^[a-zA-Z]/.test(String(value)) && kind !== 'damage') return;
            const id = Date.now() + Math.random();
            this._damagePops.push({ id, kind, value, ts: Date.now() });
            // Trim list — keep last 6 pops in memory.
            if (this._damagePops.length > 6) this._damagePops.shift();
            // Render layer on top of agent screen. Pop is a transient DOM element appended
            // to the agent-screen — auto-removes after 1400ms via CSS animation.
            setTimeout(() => {
                if (!this.rendered) return;
                const screen = this.element?.find('.agent-screen')?.[0];
                if (!screen) return;
                const pop = document.createElement('div');
                pop.className = 'cd-damage-pop cd-damage-pop--' + kind;
                pop.textContent = value;
                screen.appendChild(pop);
                setTimeout(() => pop.remove(), 1400);
            }, 30);
        } catch (e) { /* setting may not exist mid-init — fine */ }
    }

    activateListeners(html) {
        super.activateListeners(html);

        // NuNu packaging: choosing a wanted tier fills the bounty from the campaign's
        // bounty table. Tier A is open-ended, so it seeds the floor and waits for a number.
        // NuNu packaging: picking a home fills its monthly rent, still editable after.
        html.on("change", "[data-housing-row] select.va-housing", (ev) => {
            const rent = $(ev.currentTarget).find("option:selected").data("rent");
            const row = $(ev.currentTarget).closest("[data-housing-row]");
            if (rent !== undefined && rent !== "") row.find("input.va-rent").val(String(rent));
        });

        // NuNu packaging: a debt claim pays the finder a tenth of the debt.
        html.on("input change", "#ncpd-add-debt", (ev) => {
            const debt = Number(String($(ev.currentTarget).val() || "").replace(/[^0-9.]/g, ""));
            if (Number.isFinite(debt) && debt > 0) html.find("#ncpd-add-bounty").val(String(Math.round(debt / 10)));
        });
        // Bounties carry a wanted tier; debt claims carry a debt instead.
        html.on("change", "#ncpd-add-kind", (ev) => {
            const debt = String($(ev.currentTarget).val()) === "debt";
            html.find("#ncpd-add-debt").toggle(debt);
            html.find("#ncpd-add-status").toggle(!debt);
        });

        html.on("change", "#ncpd-add-status", (ev) => {
            const payouts = { "Tier: F": "100", "Tier: E": "500", "Tier: D": "1000", "Tier: C": "1500", "Tier: B": "2000", "Tier: A": "3000" };
            const field = html.find("#ncpd-add-bounty");
            const pay = payouts[String(ev.currentTarget.value)];
            if (pay && !String(field.val() || "").trim()) field.val(pay);
        });
        console.log(`[Virtual Agent] Kernel active. Module version: ${game.modules?.get('VirtualAgent')?.version || 'unknown'}`);

        // --- AUTHORITATIVE [DATA-ACTION] LISTENERS ---
        html.on('click', '[data-action]', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            const action = $(ev.currentTarget).data('action');

            // NuNu packaging: the Operator app answers its own actions.
            if (typeof action === "string" && action.startsWith("op-")) {
                await globalThis.VirtualAgentOperator?.onClick(this, action, ev, html);
                return;
            }

            switch(action) {
                case 'cancel-transfer':
                    this.showPayoutModal = false; this.render(true);
                    break;

                case 'confirm-transfer': {
                    ui.notifications.info("Agent Bank: Financial Handshake Initialized...");

                    const amount = parseInt(html.find('#transfer-amount').val());
                    const targetVal = html.find('#transfer-target').val();
                    const memo = html.find('#transfer-memo').val() || "Agent Transaction";

                    if (isNaN(amount) || amount <= 0 || !targetVal) {
                        ui.notifications.warn("Agent Error: Amount and target required.");
                        return;
                    }

                    this.showPayoutModal = false;
                    let finalFrom = this.actorUuid, finalTo = targetVal;
                    if (this.transferMode === 'bill') {
                        if (!game.user.isGM) {
                            ui.notifications.warn("Agent Error: Billing restricted to System Admin.");
                            this.render(true);
                            return;
                        }
                        finalFrom = targetVal; finalTo = this.actorUuid;
                    }

                    if (game.user.isGM) {
                        const success = await this._executeTransfer(finalFrom, finalTo, amount, memo);
                        if (success) ui.notifications.info("Agent Bank: Settlement authorized.");
                    } else {
                        // Player: route through the GM client via socket
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) {
                            ui.notifications.error("Agent Bank: No System Admin online to authorize this transfer.");
                            this.render(true);
                            return;
                        }
                        const senderActor = this._resolveActor(this.actorUuid);
                        const senderBalance = senderActor
                            ? Number(this._getActorEurobucks(senderActor).balance)
                            : Number(this._getVirtualBalance(game.user).balance);
                        if (senderBalance < amount) {
                            ui.notifications.warn("Agent Bank: Insufficient funds.");
                            this.render(true);
                            return;
                        }
                        const reqId = "agtreq_" + foundry.utils.randomID();
                        const payload = {
                            action: "transferRequest",
                            fromUuid: finalFrom,
                            toUuid: finalTo,
                            amount, memo,
                            requesterId: game.user.id,
                            requestId: reqId
                        };
                        console.log("[Virtual Agent] Emitting transferRequest:", payload);
                        game.socket.emit("module.VirtualAgent", payload);

                        // FALLBACK: also post a GM-whispered chat message with an inline
                        // AUTHORIZE button. Guarantees the GM sees the request even if
                        // the socket is dropped. Button is wired in a renderChatMessage hook.
                        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                        const _esc = (s) => (foundry.utils.escapeHTML
                            ? foundry.utils.escapeHTML(String(s ?? ""))
                            : String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
                        ChatMessage.create({
                            content: `
                                <div style="border:1px solid #ffcc00; background:#1a1300; padding:8px 10px; border-radius:4px; font-family:monospace; color:#ffcc00;">
                                    <b style="color:#fff;">AGENT BANK REQUEST</b><br>
                                    <span style="color:#ccc;">From:</span> ${_esc(game.user.name)}<br>
                                    <span style="color:#ccc;">To:</span> ${_esc(finalTo)}<br>
                                    <span style="color:#ccc;">Amount:</span> ${Number(amount)}eb<br>
                                    <span style="color:#888;">Memo:</span> ${_esc(memo)}<br>
                                    <button type="button" class="agent-transfer-authorize"
                                        data-from-uuid="${_esc(finalFrom)}" data-to-uuid="${_esc(finalTo)}"
                                        data-amount="${Number(amount)}" data-memo="${_esc(memo)}"
                                        data-requester-id="${_esc(game.user.id)}" data-request-id="${_esc(reqId)}"
                                        style="margin-top:6px; padding:4px 10px; background:rgba(255,204,0,0.15); border:1px solid #ffcc00; color:#ffcc00; cursor:pointer; font-family:monospace;">
                                        <i class="fas fa-check"></i> AUTHORIZE
                                    </button>
                                </div>`,
                            whisper: gmIds,
                            flags: { VirtualAgent: { isAgentMessage: false, isTransferRequest: true, requestId: reqId } }
                        });

                        ui.notifications.info("Agent Bank: Request transmitted to System Admin...");
                    }
                    this.render(true);
                    break;
                }

                case 'open-transfer-modal':
                    this.transferMode = $(ev.currentTarget).data('mode') || "give";
                    this.showPayoutModal = true;
                    this.render(true);
                    break;

                case 'app-icon': {
                    const app = $(ev.currentTarget).data('app');
                    // NuNu packaging: 'operator' belongs in this allowlist or the Operator tile does nothing.
                    if (['chat', 'data', 'creds', 'map', 'id', 'social', 'bio', 'admin', 'operator', 'store', 'style', 'rep', 'auction', 'ncpd', 'ziggurat', 'garden', 'combat', 'skills'].includes(app)) {
                        this.currentView = app;
                        if (app === 'store' && !this._storeCatalog && !this._storeLoading) {
                            this._loadStoreCatalog().then(() => this.render(true));
                        }
                        if (app === 'auction') {
                            this._auctionView = 'list';
                            this._auctionDetailId = null;
                        }
                        this.render(true);
                    }
                    break;
                }

                // ── 5.6.0 COMBAT app actions ──
                case 'combat-roll-initiative': {
                    // 5.8.39: roll initiative from the phone. Delegates to Foundry's
                    // combat.rollInitiative so the CPR system's own formula applies
                    // (1d10 + REF, plus role bonuses like Solo Combat Awareness, pg 170).
                    const combat = game.combat;
                    if (!combat || !this._myCombatantId) { ui.notifications.warn("You're not in the initiative tracker."); break; }
                    const cbt = combat.combatants.get(this._myCombatantId);
                    if (!cbt) { ui.notifications.warn("Combatant not found in this combat."); break; }
                    if (cbt.initiative != null) { ui.notifications.info("Initiative already rolled."); this.render(true); break; }
                    try {
                        await combat.rollInitiative([cbt.id]);
                        const _rolled = combat.combatants.get(cbt.id)?.initiative;
                        this._spawnDamagePop('move', `INIT ${_rolled ?? ''}`);
                    } catch (e) {
                        console.error('[AgentDevice 5.8.39] rollInitiative failed:', e);
                        ui.notifications.error("Initiative roll failed — see console.");
                    }
                    this.render(true);
                    break;
                }
                case 'combat-roll-npc-initiative': {
                    // 5.8.40: GM rolls initiative for every NPC combatant that hasn't rolled yet
                    // (NPC = no non-GM player owns the actor). Uses the same combat.rollInitiative
                    // path as the single-roll banner, so the CPR system's own formula applies.
                    const combat = game.combat;
                    if (!game.user.isGM) { ui.notifications.warn("Only the GM can roll NPC initiative."); break; }
                    if (!combat) { ui.notifications.warn("No active combat encounter."); break; }
                    const _npcIds = combat.combatants
                        .filter(c => c.initiative == null && !(c.players && c.players.length))
                        .map(c => c.id);
                    if (!_npcIds.length) { ui.notifications.info("All NPCs have already rolled initiative."); this.render(true); break; }
                    try {
                        await combat.rollInitiative(_npcIds);
                        this._spawnDamagePop('move', `INIT ×${_npcIds.length}`);
                        ui.notifications.info(`Rolled initiative for ${_npcIds.length} NPC${_npcIds.length === 1 ? '' : 's'}.`);
                    } catch (e) {
                        console.error('[AgentDevice 5.8.40] NPC rollInitiative failed:', e);
                        ui.notifications.error("NPC initiative roll failed — see console.");
                    }
                    this.render(true);
                    break;
                }
                case 'combat-end-turn': {
                    try {
                        if (game.combat && game.combat.started) {
                            if (game.user.isGM) {
                                await game.combat.nextTurn();
                                // 5.7.1: full per-turn reset.
                                this._combatMenu = 'main';
                                this._combatBudget = { move: 'available', action: 'available', bonus: 'available' };
                                this._attackPhase = 'weapon';
                                this._attackWeapon = null;
                                this._attackTarget = null;
                                this._attackRoll = null;
                                this._attackDamage = null;
                                this.render(true);
                            } else {
                                // 5.8.41: a player owns their combatant but not the Combat document,
                                // so calling nextTurn() here would reject. Relay to the GM, who advances;
                                // the updateCombat hook (main.js) then resets per-turn state on every client.
                                game.socket.emit("module.VirtualAgent", { action: "combatNextTurn", combatId: game.combat.id, requesterId: game.user.id });
                                ui.notifications.info('Ending turn…');
                            }
                        } else {
                            ui.notifications.info('No active combat encounter.');
                        }
                    } catch (e) {
                        console.warn('[Virtual Agent] combat-end-turn failed:', e);
                        ui.notifications.error('Could not advance combat turn.');
                    }
                    break;
                }
                case 'combat-menu-select': {
                    // 5.7.0: all six combat actions now wired.
                    const choice = ev.currentTarget.dataset.menuChoice;
                    if (choice === 'end-turn') break;
                    if (choice === 'attack') {
                        this._combatMenu = 'attack';
                        this._attackPhase = 'weapon';
                        this._attackWeapon = null;
                        this._attackTarget = null;
                        this._attackRoll = null;
                        this._attackDamage = null;
                        this.render(true);
                        break;
                    }
                    if (choice === 'item') {
                        this._combatMenu = 'item';
                        this._itemPhase  = 'pick';
                        this._itemSelected = null;
                        this._itemResult = null;
                        this.render(true);
                        break;
                    }
                    if (choice === 'skill') {
                        // SKILL inside combat → routes to the standalone SKILLS app.
                        // Player gets the same search + roll surface they already know.
                        this.currentView = 'skills';
                        this.render(true);
                        break;
                    }
                    if (choice === 'more') {
                        // 5.8.2: MORE opens submenu of less-common CPR actions (Hold/Evade/Grab/Stabilize)
                        this._combatMenu = 'more';
                        this.render(true);
                        break;
                    }
                    // 5.8.30 CHOKE — Brawling vs target's Brawling/Evasion. Damage scales with rounds held (pg 168).
                    if (choice === 'choke') {
                        const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                        if (!actor) break;
                        const dex = Number(actor.system?.stats?.dex?.value ?? 0);
                        const brItem = actor.items.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'brawling');
                        const lvl = Number(brItem?.system?.level ?? 0);
                        const r = new Roll(`1d10x10 + ${dex} + ${lvl}`);
                        await r.evaluate({ async: true });
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #ff3366; border-radius: 3px;">
                              <div style="font-size: 0.9rem; color: #ff3366; font-weight: 700; letter-spacing: 2px; margin-bottom: 6px;">⊗ CHOKE <span style="color:#888; font-size:0.6rem;">${actor.name}</span></div>
                              <div style="font-size: 0.7rem; color: #fff;">DEX+Brawling+d10 = <strong style="color:#ff3366;">${r.total}</strong></div>
                              <div style="font-size: 0.65rem; color: #ccc; margin-top: 4px;">Target rolls Brawling OR Evasion vs ${r.total} to break free — target wins a tie (CPR pg 168)</div>
                              <div style="font-size: 0.65rem; color: #ccc; margin-top: 2px;">If held, deal 1d6 damage to neck each round; +1d6 per round held (max 3d6). No armor.</div>
                            </div>`,
                            rolls: [r], type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5
                        });
                        this._combatBudget.action = 'used';
                        this._lastCombatAction = `Choke (${r.total})`;
                        this._combatMenu = 'main';  // 5.8.41: return to main menu like Hold/Evade (was stranding on MORE)
                        this.render(true);
                        break;
                    }
                    // 5.8.30 HUMAN SHIELD — use a grappled target as cover, attackers hit them first (pg 168)
                    if (choice === 'human-shield') {
                        const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                        if (!actor) break;
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #ff6e40; border-radius: 3px;">
                              <div style="font-size: 0.9rem; color: #ff6e40; font-weight: 700; letter-spacing: 2px; margin-bottom: 6px;">⛨ HUMAN SHIELD</div>
                              <div style="font-size: 0.7rem; color: #fff;">${actor.name} uses their grappled victim as cover.</div>
                              <div style="font-size: 0.65rem; color: #ccc; margin-top: 4px;">All Ranged Attacks targeting ${actor.name} hit the held victim instead until the grapple ends (CPR pg 168).</div>
                              <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px;">Requires an active Grab. GM tracks the held target.</div>
                            </div>`
                        });
                        this._combatBudget.action = 'used';
                        this._lastCombatAction = 'Human Shield';
                        this._combatMenu = 'main';  // 5.8.41: return to main menu like Hold/Evade (was stranding on MORE)
                        this.render(true);
                        break;
                    }
                    // 5.8.29 THROW — quick chat-card prompt for throwing an object (pg 172).
                    // Range = BODY×10 m for thrown items. DV from standard range table.
                    if (choice === 'throw') {
                        const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                        if (!actor) break;
                        const body = Number(actor.system?.stats?.body?.value ?? 0);
                        const athleticsItem = actor.items.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'athletics');
                        const athLvl = Number(athleticsItem?.system?.level ?? 0);
                        const dex = Number(actor.system?.stats?.dex?.value ?? 0);
                        const roll = new Roll(`1d10x10 + ${dex} + ${athLvl}`);
                        await roll.evaluate({ async: true });
                        const flavor = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #aaaaff; border-radius: 3px;">
                          <div style="font-size: 0.9rem; color: #aaaaff; font-weight: 700; letter-spacing: 2px; margin-bottom: 6px;">↗ THROW <span style="color:#888; font-size:0.6rem;">${actor.name}</span></div>
                          <div style="font-size: 0.7rem; color: #fff; margin-bottom: 4px;">DEX+Athletics+d10 = <strong style="color:#aaaaff;">${roll.total}</strong></div>
                          <div style="font-size: 0.65rem; color: #ccc;">Throw range up to <strong>${body*10} m</strong> (BODY×10). DV from standard range table for object size (CPR pg 172).</div>
                          <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px;">If thrown weapon (knife, grenade), damage rolls separately. GM applies based on what was thrown.</div>
                        </div>`;
                        await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: flavor, rolls: [roll], type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5 });
                        this._combatBudget.action = 'used';
                        this._lastCombatAction = `Throw (${roll.total})`;
                        this._combatMenu = 'main';  // 5.8.41: return to main menu like Hold/Evade (was stranding on MORE)
                        this.render(true);
                        break;
                    }
                    if (choice === 'move') {
                        // 5.8.10 — opens distance picker bounded by MOVE stat × 2 (CPR pg 127)
                        const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                        if (!actor) break;
                        const moveStat = Number(actor.system?.stats?.move?.value ?? 4);
                        const distMax = moveStat * 2;
                        if (this._combatBudget.move === 'used') {
                            // 5.8.32: RAW pg 168 — Run = "an ADDITIONAL Move Action, but only if you
                            // have already taken a Move Action this Turn". Post-move Run was blocked
                            // here despite the 5.8.27 changelog claiming otherwise. Opens a run-only
                            // picker: extra MOVE×2 (not ×4 — the first move already happened), spends Action.
                            if (this._combatBudget.action === 'used') {
                                ui.notifications.warn("Move and Action both used this turn.");
                                break;
                            }
                            this._movePending = { distanceMax: distMax, distanceMaxWithRun: distMax, distanceChosen: distMax, moveStat, isRun: true, runOnly: true };
                            this.render(true);
                            break;
                        }
                        // 5.8.31: seed isRun + distanceMaxWithRun so the RUN toggle (pg 168)
                        // has the fields its handler, viewmodel, and template already expect.
                        this._movePending = { distanceMax: distMax, distanceMaxWithRun: moveStat * 4, distanceChosen: distMax, moveStat, isRun: false, runOnly: false };
                        this.render(true);
                        break;
                    }
                    if (choice === 'reload') {
                        // RELOAD: refill the equipped weapon's magazine, consume action.
                        // 5.8.41: resolve the ACTIVE combatant first (was bound-actor only, so a GM
                        // running an NPC reloaded their own character or no-op'd) — matches every other action.
                        const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                        if (!actor) break;
                        // Find first weapon with non-full mag.
                        const wep = (actor.items?.contents || []).find(it => it.type === 'weapon' &&
                            (it.system?.magazine?.value ?? 0) < (it.system?.magazine?.max ?? 0));
                        if (!wep) { ui.notifications.info("No weapon needs reloading."); break; }
                        const max = wep.system?.magazine?.max ?? 0;
                        await wep.update({ 'system.magazine.value': max });
                        this._combatBudget.action = 'used';
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: `<div style="font-family: monospace; font-size: 0.75rem;"><strong style="color:#ffcc00;">${actor.name} — RELOADS ${wep.name}</strong><br><span style="color:#888; font-size: 0.65rem;">${max}/${max} loaded</span></div>`
                        });
                        this._spawnDamagePop('reload', `${max}/${max}`);
                        this.render(true);
                        break;
                    }
                    ui.notifications.info(`${choice.toUpperCase()} — unhandled.`);
                    break;
                }
                // ── 5.7.0 ITEM sub-flow ──
                case 'combat-item-pick': {
                    this._itemSelected = ev.currentTarget.dataset.itemId;
                    // 5.8.41: the ITEM list is built from the ACTIVE combatant, so resolve that actor
                    // first (was bound-actor only → the item id never matched → silent no-op on GM NPC turns).
                    const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                    const it = actor?.items?.get(this._itemSelected);
                    if (!actor || !it) break;
                    // Consume one charge / quantity if possible.
                    const qty = it.system?.amount ?? it.system?.quantity ?? 1;
                    const newQty = Math.max(0, qty - 1);
                    try {
                        if (it.system?.amount !== undefined) await it.update({ 'system.amount': newQty });
                        else if (it.system?.quantity !== undefined) await it.update({ 'system.quantity': newQty });
                    } catch (e) { /* not all items have a counter */ }
                    this._combatBudget.action = 'used';
                    this._itemResult = { name: it.name, remaining: newQty };
                    this._itemPhase = 'result';
                    ChatMessage.create({
                        speaker: ChatMessage.getSpeaker({ actor }),
                        content: `<div style="font-family: monospace; font-size: 0.75rem;"><strong style="color:#ffaa00;">${actor.name} uses ${it.name}</strong><br><span style="color:#888; font-size: 0.65rem;">${newQty} remaining</span></div>`
                    });
                    this._spawnDamagePop('item', it.name);
                    this.render(true);
                    break;
                }
                case 'combat-item-finish': {
                    this._combatMenu = 'main';
                    this._itemPhase  = 'pick';
                    this._itemSelected = null;
                    this._itemResult = null;
                    this.render(true);
                    break;
                }
                // ── 5.8.2 MORE submenu handlers (real CPR actions) ──
                case 'combat-more-select': {
                    // 5.8.10: HOLD + EVADE execute now; GRAB + STABILIZE open target picker first.
                    const choice = ev.currentTarget.dataset.moreChoice;
                    const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                    if (!actor) break;
                    const _hpV = Number(actor.system?.hp?.value ?? actor.system?.derivedStats?.hp?.value ?? 0);
                    const _hpM = Number(actor.system?.hp?.max ?? actor.system?.derivedStats?.hp?.max ?? 1);
                    let wp = 0;
                    if (_hpV < 1) wp = -4;
                    else if (_hpM > 0 && _hpV < Math.ceil(_hpM / 2)) wp = -2;

                    if (choice === 'hold') {
                        this._combatBudget.action = 'used';
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: `<div style="font-family: monospace; padding: 8px; background: rgba(5,5,16,0.92); border-left: 3px solid #aaaaff; border-radius: 3px;">
                                <div style="font-size: 0.9rem; color: #aaaaff; font-weight: 700; letter-spacing: 2px;">${actor.name.toUpperCase()} — HOLDS ACTION</div>
                                <div style="font-size: 0.6rem; color: #aaa; margin-top: 4px;">Action deferred until later in Initiative Queue</div>
                                <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(170,170,255,0.2);"><span style="color:#aaaaff; white-space: nowrap;">RULES</span> Choose trigger condition or initiative slot (CPR pg 168)</div>
                            </div>`
                        });
                        this._spawnDamagePop('move', 'HOLD');
                        this._combatMenu = 'main'; this.render(true); break;
                    }
                    if (choice === 'evade') {
                        const dex = Number(actor.system?.stats?.dex?.value ?? 0);
                        const ref = Number(actor.system?.stats?.ref?.value ?? 0);
                        const evItem = actor.items.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'evasion');
                        const lvl = Number(evItem?.system?.level ?? 0);
                        const r = new Roll(`1d10x10 + ${dex} + ${lvl}${wp ? ' '+wp : ''}`);
                        await r.evaluate({ async: true });
                        const refOK = ref >= 8;
                        await r.toMessage({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            flavor: `<div style="font-family: monospace; padding: 8px; background: rgba(5,5,16,0.92); border-left: 3px solid #00ffcc; border-radius: 3px;">
                                <div style="font-size: 0.9rem; color: #00ffcc; font-weight: 700; letter-spacing: 2px;">${actor.name.toUpperCase()} — EVASION CHECK</div>
                                <div style="font-size: 0.6rem; color: #aaa; margin-top: 4px;">DEX ${dex} + Evasion ${lvl}${wp ? ' '+wp+' wounded' : ''} = +${dex+lvl+wp}</div>
                                <div style="font-size: 0.62rem; color: ${refOK ? '#bbb' : '#ff7799'}; margin-top: 4px;">${refOK ? 'REF ' + ref + ' ≥ 8: may dodge ranged or melee' : 'REF ' + ref + ' &lt; 8: melee dodge only (pg 173)'}</div>
                                <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(0,255,204,0.2);"><span style="color:#00ffcc; white-space: nowrap;">RULES</span> Attacker must beat this total — ties go to the evader (CPR pg 170)</div>
                            </div>`
                        });
                        this._spawnDamagePop('defend', String(r.total));
                        this._combatMenu = 'main'; this.render(true); break;
                    }
                    if (choice === 'grab' || choice === 'stabilize') {
                        // Open target picker
                        this._morePendingAction = choice;
                        this.render(true); break;
                    }
                    break;
                }
                case 'combat-more-pick-target': {
                    const tokenId = ev.currentTarget.dataset.tokenId;
                    const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                    const tgtTok = canvas?.tokens?.get(tokenId);
                    const tgtName = tgtTok?.name || '?';
                    if (!actor) { this._morePendingAction = null; this.render(true); break; }
                    const _hpV = Number(actor.system?.hp?.value ?? actor.system?.derivedStats?.hp?.value ?? 0);
                    const _hpM = Number(actor.system?.hp?.max ?? actor.system?.derivedStats?.hp?.max ?? 1);
                    let wp = 0;
                    if (_hpV < 1) wp = -4;
                    else if (_hpM > 0 && _hpV < Math.ceil(_hpM / 2)) wp = -2;
                    if (this._morePendingAction === 'grab') {
                        const dex = Number(actor.system?.stats?.dex?.value ?? 0);
                        const brItem = actor.items.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'brawling');
                        const lvl = Number(brItem?.system?.level ?? 0);
                        const r = new Roll(`1d10x10 + ${dex} + ${lvl}${wp ? ' '+wp : ''}`);
                        await r.evaluate({ async: true });
                        await r.toMessage({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            flavor: `<div style="font-family: monospace; padding: 8px; background: rgba(5,5,16,0.92); border-left: 3px solid #ffaa00; border-radius: 3px;">
                                <div style="font-size: 0.9rem; color: #ffaa00; font-weight: 700; letter-spacing: 2px;">${actor.name.toUpperCase()} — GRAB <span style="color: #888; font-size: 0.6rem;">→ ${tgtName}</span></div>
                                <div style="font-size: 0.6rem; color: #aaa; margin-top: 4px;">DEX ${dex} + Brawling ${lvl}${wp ? ' '+wp+' wounded' : ''} = +${dex+lvl+wp}</div>
                                <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(255,170,0,0.2);"><span style="color:#ffaa00; white-space: nowrap;">RULES</span> Target resists with Brawling OR Evasion vs ${r.total} — target wins a tie (CPR pg 177)</div>
                            </div>`
                        });
                        this._combatBudget.action = 'used';
                        this._spawnDamagePop('item', 'GRAB');
                    } else if (this._morePendingAction === 'stabilize') {
                        const tech = Number(actor.system?.stats?.tech?.value ?? 0);
                        const faItem = actor.items.find(it => it.type === 'skill' &&
                            (it.name?.toLowerCase() === 'first aid' || it.name?.toLowerCase() === 'paramedic'));
                        const lvl = Number(faItem?.system?.level ?? 0);
                        const skName = faItem?.name || 'First Aid';
                        const tgtActor = tgtTok?.actor;
                        const tHpV = Number(tgtActor?.system?.hp?.value ?? tgtActor?.system?.derivedStats?.hp?.value ?? 1);
                        const dvTarget = tHpV < 1 ? 15 : 13;
                        const dvLabel = tHpV < 1 ? 'Mortally Wounded' : 'Wounded';
                        const r = new Roll(`1d10x10 + ${tech} + ${lvl}${wp ? ' '+wp : ''}`);
                        await r.evaluate({ async: true });
                        const success = r.total >= dvTarget;
                        await r.toMessage({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            flavor: `<div style="font-family: monospace; padding: 8px; background: rgba(5,5,16,0.92); border-left: 3px solid ${success ? '#00ffcc' : '#ff3366'}; border-radius: 3px;">
                                <div style="font-size: 0.9rem; color: #22ddff; font-weight: 700; letter-spacing: 2px;">${actor.name.toUpperCase()} — STABILIZE <span style="color: #888; font-size: 0.6rem;">→ ${tgtName}</span></div>
                                <div style="font-size: 0.6rem; color: #aaa; margin-top: 4px;">TECH ${tech} + ${skName} ${lvl}${wp ? ' '+wp+' wounded' : ''} vs DV${dvTarget} (${dvLabel})</div>
                                <div style="font-size: 0.7rem; color: ${success ? '#00ffcc' : '#ff3366'}; font-weight: 700; margin-top: 4px;">${success ? '★ STABILIZED' : '✕ FAILED'}</div>
                                <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(34,221,255,0.2);"><span style="color:#22ddff; white-space: nowrap;">RULES</span> ${success ? 'Healed to 1 HP — unconscious 1 min, Death Save Penalty resets to base' : 'Failed — no effect; retry next turn for an Action'} (CPR pg 222)</div>
                            </div>`
                        });
                        this._combatBudget.action = 'used';
                        this._spawnDamagePop(success ? 'item' : 'damage', success ? 'HEAL' : 'FAIL');
                        // 5.8.30: on success, actually heal target to 1 HP + announce unconscious (CPR pg 222)
                        if (success && tgtActor) {
                            try {
                                const _curHp = Number(tgtActor.system?.derivedStats?.hp?.value ?? tgtActor.system?.hp?.value ?? 0);
                                if (_curHp < 1) {
                                    const _canUpdate = game.user.isGM || (tgtActor.testUserPermission?.(game.user, 'OWNER') ?? false);
                                    if (_canUpdate) {
                                        if (tgtActor.system?.derivedStats?.hp?.value !== undefined) {
                                            await tgtActor.update({ 'system.derivedStats.hp.value': 1 });
                                        } else if (tgtActor.system?.hp?.value !== undefined) {
                                            await tgtActor.update({ 'system.hp.value': 1 });
                                        }
                                        // 5.8.32: Stabilization resets Death Save Penalty to Base (pg 187)
                                        try {
                                            const _base = Number(tgtActor.getFlag?.('VirtualAgent', 'deathSaveBasePenalty') ?? 0);
                                            await tgtActor.setFlag?.('VirtualAgent', 'deathSavePenalty', _base);
                                            // 1.5.2 — stabilized back to 1 HP: clear the death marker so saves can resume if re-downed
                                            try { await tgtActor.unsetFlag?.('VirtualAgent', 'agentDead'); } catch (e) {}
                                        } catch (e) {}
                                    } else {
                                        game.socket.emit("module.VirtualAgent", { action: "combatStabilizeHeal", targetUuid: tgtActor.uuid });
                                    }
                                    // Announce unconscious for 1 min
                                    ChatMessage.create({
                                        speaker: { alias: 'AgentDevice — Stabilize' },
                                        content: `<div style="font-family: monospace; padding: 8px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #00ffcc; border-radius: 3px;">
                                          <div style="font-size: 0.85rem; color: #00ffcc; font-weight: 700; letter-spacing: 2px; margin-bottom: 4px;">✚ STABILIZED → 1 HP</div>
                                          <div style="font-size: 0.65rem; color: #fff;">${tgtActor.name} is unconscious for 1 minute. No longer Mortally Wounded; no more Death Saves needed.</div>
                                          <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px;">CPR pg 222</div>
                                        </div>`
                                    });
                                }
                            } catch (e) { console.warn('[AgentDevice 5.8.30] stabilize heal failed:', e); }
                        }
                    }
                    this._morePendingAction = null;
                    this._combatMenu = 'main';
                    this.render(true); break;
                }

                // ── 5.6.2 ATTACK sub-flow handlers ──
                case 'move-pick-step': {
                    if (!this._movePending) break;
                    const delta = Number(ev.currentTarget.dataset.delta || 0);
                    const m = this._movePending;
                    const _max = m.isRun ? m.distanceMaxWithRun : m.distanceMax;
                    m.distanceChosen = Math.max(0, Math.min(_max, m.distanceChosen + delta));
                    this.render(true); break;
                }
                case 'move-pick-quick': {
                    if (!this._movePending) break;
                    const frac = Number(ev.currentTarget.dataset.frac || 1);
                    const _maxF = this._movePending.isRun ? this._movePending.distanceMaxWithRun : this._movePending.distanceMax;
                    this._movePending.distanceChosen = Math.round(_maxF * frac);
                    this.render(true); break;
                }
                case 'move-toggle-run': {
                    // 5.8.31: wire the RUN toggle. It was rendered in the template with a
                    // viewmodel + read-side distance math, but no handler case ever set
                    // isRun — so the button did nothing. RUN spends the Action to take an
                    // extra Move Action (CPR pg 168): max distance MOVE × 4 instead of × 2.
                    if (!this._movePending) break;
                    // 5.8.32: run-only picker (post-move Run) — RUN is the whole point, can't toggle off.
                    if (this._movePending.runOnly) {
                        ui.notifications.warn("Move already used — this picker IS the Run extra Move Action (pg 168).");
                        break;
                    }
                    const turningOn = !this._movePending.isRun;
                    if (turningOn && this._combatBudget.action === 'used') {
                        ui.notifications.warn("RUN needs your Action, but it's already used this turn.");
                        break;
                    }
                    this._movePending.isRun = turningOn;
                    // Snap the chosen distance to the new max (picker opens at full distance).
                    this._movePending.distanceChosen = turningOn
                        ? this._movePending.distanceMaxWithRun
                        : this._movePending.distanceMax;
                    this.render(true); break;
                }
                case 'move-cancel': {
                    this._movePending = null; this.render(true); break;
                }
                case 'move-confirm': {
                    if (!this._movePending) break;
                    const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                    const m = this._movePending;
                    this._combatBudget.move = 'used';
                    // 5.8.27: if RUN active, also consume Action (pg 168 — extra Move via Action)
                    if (m.isRun) { this._combatBudget.action = 'used'; }
                    if (actor) {
                        const _runOn = !!m.isRun;
                        const _effMax = _runOn ? m.distanceMaxWithRun : m.distanceMax;
                        const _accent = _runOn ? '#ffaa00' : '#aaaaff';
                        ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: `<div style="font-family: monospace; padding: 8px; background: rgba(5,5,16,0.92); border-left: 3px solid ${_accent}; border-radius: 3px;">
                                <div style="font-size: 0.9rem; color: ${_accent}; font-weight: 700; letter-spacing: 2px;">${actor.name.toUpperCase()} — ${_runOn ? 'RUNS' : 'MOVES'}</div>
                                <div style="font-size: 0.65rem; color: #fff; margin-top: 4px;">${m.distanceChosen} m / yds <span style="color: #888;">(of ${_effMax} max)</span></div>
                                <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px; padding-top: 4px; border-top: 1px solid rgba(170,170,255,0.2);"><span style="color:${_accent}; white-space: nowrap;">RULES</span> ${_runOn ? (m.runOnly ? `RUN — extra Move Action: MOVE ${m.moveStat} × 2 = ${_effMax} m more, Action spent (CPR pg 168)` : `RUN — MOVE stat ${m.moveStat} × 4 = ${_effMax} m max, Action spent (CPR pg 168)`) : `MOVE stat ${m.moveStat} × 2 = ${m.distanceMax} m max (CPR pg 127)`}</div>
                            </div>`
                        });
                    }
                    this._spawnDamagePop('move', `${m.distanceChosen}m`);
                    this._movePending = null;
                    this.render(true); break;
                }

                                case 'combat-attack-pick-weapon': {
                    this._attackWeapon = ev.currentTarget.dataset.weaponId;
                    this._attackPhase = 'target';
                    this.render(true);
                    break;
                }
                case 'combat-attack-pick-target': {
                    this._attackTarget = ev.currentTarget.dataset.tokenId;
                    this._attackPhase = 'roll';
                    this.render(true);
                    break;
                }
                // ── 5.8.8 attack-roll prep dialog handlers ──
                case 'attack-prep-cancel': {
                    this._attackRollPrep = null; this.render(true); break;
                }
                case 'attack-prep-dv-step': {
                    if (!this._attackRollPrep) break;
                    this._attackRollPrep.dvOverride = Math.max(0, (this._attackRollPrep.dvOverride || 0) + Number(ev.currentTarget.dataset.delta || 0));
                    this.render(true); break;
                }
                case 'attack-prep-dv-auto': {
                    if (!this._attackRollPrep) break;
                    this._attackRollPrep.dvOverride = this._attackRollPrep.autoDV || 0;
                    this.render(true); break;
                }
                case 'attack-prep-mod-step': {
                    if (!this._attackRollPrep) break;
                    this._attackRollPrep.modifier += Number(ev.currentTarget.dataset.delta || 0);
                    this.render(true); break;
                }
                case 'attack-prep-mod-add': {
                    if (!this._attackRollPrep) break;
                    this._attackRollPrep.modifier += Number(ev.currentTarget.dataset.modValue || 0);
                    this.render(true); break;
                }
                case 'attack-prep-luck-step': {
                    if (!this._attackRollPrep) break;
                    const _act = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                    const _maxLuck = Number(_act?.system?.stats?.luck?.value ?? 0);
                    const _d = Number(ev.currentTarget.dataset.delta || 0);
                    this._attackRollPrep.luckSpent = Math.max(0, Math.min(_maxLuck, this._attackRollPrep.luckSpent + _d));
                    this.render(true); break;
                }
                case 'attack-prep-reset': {
                    if (!this._attackRollPrep) break;
                    this._attackRollPrep.modifier = 0;
                    this._attackRollPrep.luckSpent = 0;
                    this._attackRollPrep.dvOverride = this._attackRollPrep.autoDV || 0;
                    this._attackRollPrep.fireMode = 'single';
                    this.render(true); break;
                }
                // 5.8.27: toggle defender evasion (REF 8+ targets)
                case 'attack-prep-evade-toggle': {
                    if (!this._attackRollPrep) break;
                    if (!this._attackRollPrep.canEvade) { ui.notifications.warn("Target REF < 8 — cannot dodge ranged attacks."); break; }
                    this._attackRollPrep.evadeActive = !this._attackRollPrep.evadeActive;
                    this.render(true); break;
                }
                // 5.8.26: switch fire mode. Aimed Shot auto-sets -8 modifier (CPR pg 169).
                case 'attack-prep-fire-mode': {
                    if (!this._attackRollPrep) break;
                    const _newMode = $(ev.currentTarget).data('mode');
                    const _prevMode = this._attackRollPrep.fireMode;
                    this._attackRollPrep.fireMode = _newMode;
                    // Auto-apply -8 when switching TO any aimed mode; clear it when switching away
                    if (String(_newMode).startsWith('aimed-') && !String(_prevMode).startsWith('aimed-')) {
                        this._attackRollPrep.modifier = (this._attackRollPrep.modifier || 0) - 8;
                    } else if (!String(_newMode).startsWith('aimed-') && String(_prevMode).startsWith('aimed-')) {
                        this._attackRollPrep.modifier = (this._attackRollPrep.modifier || 0) + 8;
                    }
                    this.render(true); break;
                }
                // 1.4.0 — pick the ammo type loaded for this shot
                case 'attack-prep-ammo': {
                    if (!this._attackRollPrep) break;
                    this._attackRollPrep.ammoType = $(ev.currentTarget).data('ammo') || 'basic';
                    this.render(true); break;
                }
                case 'combat-attack-roll': {
                    // 1.7.0 — don't re-enter while an attack is mid-resolution (awaiting the reactive dodge).
                    if (this._attackAwaitingDodge) {
                        ui.notifications.warn("Resolving the attack — waiting on the defender's reaction…");
                        break;
                    }
                    // 5.8.2 CPR-correct: ranged uses REF (pg 173), melee uses DEX (pg 175).
                    // 5.8.7: actor follows active combatant when GM controls NPC's turn.
                    // 5.8.8: opens prep dialog on first invocation; second invocation executes the roll.
                    const actor = (game.combat?.combatant?.actor) || this._resolveActor(this.actorUuid);
                    if (!actor) { ui.notifications.warn("No active character."); break; }
                    const wep   = actor.items.get(this._attackWeapon);
                    if (!wep)   { ui.notifications.warn("Weapon not found."); break; }
                    // 5.8.22: block unloaded ranged weapons before any roll. CPR pg 173 — you can't
                    // fire what isn't loaded. Skip the check on melee (magazine.max=0 or null).
                    // 5.8.29: bows/crossbows reload as part of attack (pg 173) — never blocked
                    const _magMax = Number(wep.system?.magazine?.max ?? 0);
                    const _magVal = Number(wep.system?.magazine?.value ?? wep.system?.magazine?.current ?? 0);
                    const _wtypeChk = String(wep.system?.weaponType || '').toLowerCase();
                    const _isBowChk = (_wtypeChk === 'bow' || _wtypeChk === 'crossbow');
                    if (_magMax > 0 && _magVal <= 0 && !_isBowChk) {
                        ui.notifications.warn(`${wep.name} is UNLOADED. Reload before firing.`);
                        this._attackRollPrep = null;
                        this.render(true);
                        break;
                    }
                    // First click: open the prep dialog
                    if (!this._attackRollPrep) {
                        // Auto-compute DV from range
                        let _autoDV0 = 13;  // sensible default
                        try {
                            const _myT = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id);
                            const _tgtT = canvas?.tokens?.get(this._attackTarget);
                            if (_myT && _tgtT && Array.isArray(wep.system?.dvTable)) {
                                const _dist = canvas.grid.measureDistance(_myT.center, _tgtT.center);
                                const _bands = [6, 12, 25, 50, 100, 200, 400, 800];
                                const _bi = _bands.findIndex(b => _dist <= b);
                                if (_bi >= 0 && wep.system.dvTable[_bi]) _autoDV0 = Number(wep.system.dvTable[_bi]) || _autoDV0;
                            }
                        } catch (e) {}
                        // 5.8.26: detect fire mode capabilities. SMG/AR support Autofire+Suppressive (pg 173).
                        // Any ranged weapon with ROF >= 1 supports Aimed Shot (pg 169). Melee = single only.
                        const _wtypeRaw = String(wep.system?.weaponType || '').toLowerCase();
                        const _skillNameLower = String(wep.system?.weaponSkill || wep.system?.skill || '').toLowerCase();
                        const _isMeleeWep = ['brawling','martial arts','melee weapon'].includes(_skillNameLower) ||
                                            /melee|knife|sword|club|axe|bat|baton|unarmed/i.test(_wtypeRaw);
                        const _isRanged = !_isMeleeWep && Number(wep.system?.magazine?.max ?? 0) > 0;
                        const _supportsAutofire = _isRanged && (_wtypeRaw === 'smg' || _wtypeRaw === 'assaultrifle' || _wtypeRaw === 'heavymachinegun');
                        const _supportsAimed = _isRanged;  // any ranged weapon, costs -8 + 1 ROF
                        // 5.8.29: shotguns can fire shell mode (multi-target scatter); explosives have area effect
                        const _supportsShell = _isRanged && _wtypeRaw === 'shotgun';
                        const _supportsExplosive = _isRanged && (_wtypeRaw === 'grenadelauncher' || _wtypeRaw === 'rocketlauncher' || /grenade|rocket|missile|explosive/i.test(_wtypeRaw));
                        // 5.8.27 reactive evasion: CPR pg 173 — only available when target has REF 8+ and attack is ranged
                        let _canEvade = false;
                        try {
                            const _tA = canvas?.tokens?.get(this._attackTarget)?.actor;
                            const _tRef = Number(_tA?.system?.stats?.ref?.value ?? 0);
                            _canEvade = _isRanged && _tRef >= 8;
                        } catch (e) {}
                        this._attackRollPrep = {
                            weaponName: wep.name,
                            targetName: (canvas?.tokens?.get(this._attackTarget)?.name) || '?',
                            autoDV: _autoDV0,
                            dvOverride: _autoDV0,
                            modifier: 0,
                            luckSpent: 0,
                            fireMode: 'single',          // 5.8.26
                            ammoType: 'basic',           // 1.4.0 ammo-type picker
                            supportsAimed: _supportsAimed,
                            supportsAutofire: _supportsAutofire,
                            supportsSuppressive: _supportsAutofire,
                            supportsShell: _supportsShell,         // 5.8.29 shotgun shell scatter mode
                            supportsExplosive: _supportsExplosive, // 5.8.29 explosive area effect
                            weaponTypeKey: _wtypeRaw,
                            isMeleeWep: _isMeleeWep,
                            canEvade: _canEvade,         // 5.8.27
                            evadeActive: false           // 5.8.27 toggle state
                        };
                        this.render(true);
                        break;
                    }
                    const skillName = wep.system?.weaponSkill || wep.system?.skill || '';
                    const meleeSkills = ['brawling', 'martial arts', 'melee weapon'];
                    const isMelee = meleeSkills.includes(String(skillName).toLowerCase()) ||
                                    /melee|knife|sword|club|axe|bat|baton/i.test(String(wep.system?.weaponType || ''));
                    const statKey = isMelee ? 'dex' : 'ref';
                    const statVal = Number(actor.system?.stats?.[statKey]?.value ?? 0);
                    const ref = statVal;  // compat alias
                    const skillItem = actor.items.find(it => it.type === 'skill' &&
                        (it.name?.toLowerCase() === String(skillName).toLowerCase()));
                    const skillLvl = Number(skillItem?.system?.level ?? 0);
                    const atkMod = Number(wep.system?.attackmod ?? 0);
                    // CPR pg 186 wound state penalties (apply to all Actions):
                    //   Seriously Wounded: -2 (HP < ceil(max/2))
                    //   Mortally Wounded: -4 (HP < 1)
                    const hpV_a = Number(actor.system?.hp?.value ?? actor.system?.derivedStats?.hp?.value ?? 0);
                    const hpM_a = Number(actor.system?.hp?.max ?? actor.system?.derivedStats?.hp?.max ?? 1);
                    let woundPenalty = 0;
                    if (hpV_a < 1) woundPenalty = -4;
                    else if (hpM_a > 0 && hpV_a < Math.ceil(hpM_a / 2)) woundPenalty = -2;
                    // 5.8.8: include user-set modifier + LUCK spend from prep dialog
                    const _prepMod = Number(this._attackRollPrep?.modifier || 0);
                    const _prepLuck = Number(this._attackRollPrep?.luckSpent || 0);
                    // 5.8.27: if defender dodge active, roll DEX+Evasion+1d10 to replace static DV (CPR pg 173)
                    if (this._attackRollPrep?.evadeActive) {
                        try {
                            const _tA = canvas?.tokens?.get(this._attackTarget)?.actor;
                            const _tDex = Number(_tA?.system?.stats?.dex?.value ?? 0);
                            const _evItem = _tA?.items?.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'evasion');
                            const _evLvl = Number(_evItem?.system?.level ?? 0);
                            const _evRoll = new Roll(`1d10x10 + ${_tDex} + ${_evLvl}`);
                            await _evRoll.evaluate({ async: true });
                            this._attackRollPrep.dvOverride = _evRoll.total;
                            // Post the defender's evasion roll to chat so everyone sees it
                            await ChatMessage.create({
                                speaker: { alias: 'AgentDevice — ' + (_tA?.name || 'Defender') },
                                content: `<div style="font-family: monospace; padding: 8px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #22ddff; border-radius: 3px;">
                                  <div style="font-size: 0.75rem; color: #22ddff; font-weight: 700; letter-spacing: 2px;">↺ DEFENDER DODGES</div>
                                  <div style="font-size: 0.65rem; color: #fff; margin-top: 4px;">${_tA?.name || 'Target'} rolls <strong style="color:#22ddff;">${_evRoll.total}</strong> to evade</div>
                                  <div style="font-size: 0.62rem; color: #bbb; margin-top: 2px;">DEX ${_tDex} + Evasion ${_evLvl} + 1d10 · attack DV replaced (CPR pg 173)</div>
                                </div>`,
                                rolls: [_evRoll],
                                type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5
                            });
                        } catch (e) { console.warn('[AgentDevice 5.8.27] evasion roll failed:', e); }
                    }
                    // 5.8.26: branch on fire mode. Suppressive doesn't roll attack; Autofire uses Autofire skill + separate range table.
                    const _fireMode = this._attackRollPrep?.fireMode || 'single';
                    // SUPPRESSIVE FIRE (pg 173) — no attack roll, post area-effect prompt + consume 10 bullets
                    if (_fireMode === 'suppressive') {
                        try {
                            // Consume 10 bullets
                            const _curMag = Number(wep.system?.magazine?.value ?? 0);
                            if (_curMag < 10) {
                                ui.notifications.warn(`${wep.name} needs 10 bullets for Suppressive Fire (has ${_curMag}).`);
                                break;
                            }
                            await wep.update({ 'system.magazine.value': _curMag - 10 });
                            const _autoSkillItem = actor.items.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'autofire');
                            const _autoSkill = Number(_autoSkillItem?.system?.level ?? 0);
                            const _ref = Number(actor.system?.stats?.ref?.value ?? 0);
                            const _suppRoll = new Roll(`1d10x10 + ${_ref} + ${_autoSkill}`);
                            await _suppRoll.evaluate({ async: true });
                            const _flav = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #ffaa00; border-radius: 3px;">
                              <div style="font-size: 0.9rem; color: #ffaa00; font-weight: 700; letter-spacing: 2px; text-shadow: 0 0 6px #ffaa00; margin-bottom: 6px;">▦ SUPPRESSIVE FIRE <span style="color:#888; font-size:0.6rem;">${wep.name}</span></div>
                              <div style="font-size: 0.7rem; color: #fff; margin-bottom: 6px;">Attacker rolled <strong style="color:#ffaa00;">${_suppRoll.total}</strong> (REF+Autofire+1d10)</div>
                              <div style="font-size: 0.65rem; color: #ccc; margin-bottom: 4px;">All targets within <strong>25m/yds</strong>, out of cover, in LOS roll <strong style="color:#22ddff;">WILL + Concentration + 1d10</strong> vs <strong style="color:#ffaa00;">${_suppRoll.total}</strong></div>
                              <div style="font-size: 0.65rem; color: #ccc;">Failed targets must use their next Move Action to get into cover (CPR pg 173)</div>
                              <div style="font-size: 0.58rem; color: #999; margin-top: 6px;">−10 bullets · no damage dealt</div>
                            </div>`;
                            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: _flav, rolls: [_suppRoll], type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5 });
                            this._lastCombatAction = `Suppressive Fire (${_suppRoll.total})`;
                            this._combatBudget.action = 'used';  // 5.8.32: pg 173 — costs an Action (was only set on FINISH click)
                            this._attackPhase = 'result';
                            this._attackRollPrep = null;
                            this.render(true);
                        } catch (e) { console.error('[AgentDevice 5.8.26] suppressive fire failed:', e); }
                        break;
                    }
                    // 5.8.32: shared attack-check formula builder (also used by the shell path below)
                    const formulaParts = () => `1d10x10 + ${statVal} + ${skillLvl} + ${atkMod}${woundPenalty ? ' '+woundPenalty : ''}${_prepMod ? (_prepMod >= 0 ? ' + '+_prepMod : ' '+_prepMod) : ''}${_prepLuck ? ' + '+_prepLuck : ''}`;
                    // SHOTGUN SHELL (pg 173) — 5.8.32 RAW rework. Verbatim: "you make 1 Ranged Attack
                    // (REF + Shoulder Arms + 1d10) vs. a DV13. If successful every target in front of you,
                    // within 6 m/yds (3 squares), that you can see, takes 3d6 damage. You roll damage once
                    // for all targets." No aiming with shells. The 5.8.29 version wrongly used the range-table
                    // DV and the weapon's own damage and continued to the single-target flow.
                    if (_fireMode === 'shell') {
                        try {
                            const _shRoll = new Roll(formulaParts());
                            await _shRoll.evaluate({ async: true });
                            const _shNat = _shRoll.dice?.[0]?.results?.[0]?.result;
                            let _shFumbleSub = 0;
                            if (_shNat === 1) {
                                const _fr = new Roll('1d10'); await _fr.evaluate({ async: true });
                                _shFumbleSub = _fr.total;  // pg 130: crit failure subtracts a second d10
                            }
                            const _shTotal = _shRoll.total - _shFumbleSub;
                            const _shHit = _shTotal > 13;  // beat DV13, defender wins ties (pg 170)
                            let _shDmg = null;
                            if (_shHit) { _shDmg = new Roll('3d6'); await _shDmg.evaluate({ async: true }); }
                            // consume 1 shell
                            if (_magMax > 0) { try { await wep.update({ 'system.magazine.value': Math.max(0, _magVal - 1) }); } catch (e) {} }
                            const _shAccent = _shHit ? '#ffaa00' : '#888888';
                            const _scatterMsg = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid ${_shAccent}; border-radius: 3px;">
                              <div style="font-size: 0.9rem; color: ${_shAccent}; font-weight: 700; letter-spacing: 2px; margin-bottom: 6px;">▥ SHOTGUN SHELL ${_shHit ? '— HIT' : '— MISS'} <span style="color:#888; font-size:0.6rem;">${wep.name}</span></div>
                              <div style="font-size: 0.7rem; color: #fff; margin-bottom: 4px;">Attack <strong style="color:${_shAccent};">${_shTotal}</strong> vs flat <strong>DV13</strong>${_shFumbleSub ? ` <span style="color:#ff3366;">(✕ fumble −${_shFumbleSub})</span>` : ''}</div>
                              ${_shHit ? `<div style="font-size: 0.65rem; color: #fff; margin-bottom: 4px;">Every target in front of you, within <strong>6 m/yds</strong>, that you can see takes <strong style="color:#ffaa00;">${_shDmg.total}</strong> (3d6, rolled once for all — minus each target's body SP, armor ablates)</div>` : ''}
                              <div style="font-size: 0.65rem; color: #ccc;">Targets with REF 8+ may individually dodge with DEX+Evasion+1d10 vs ${_shTotal} (CPR pg 173)</div>
                              <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px;">−1 shell · GM applies damage per target in the arc</div>
                            </div>`;
                            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: _scatterMsg, rolls: _shDmg ? [_shRoll, _shDmg] : [_shRoll], type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5 });
                            this._lastCombatAction = `Shotgun Shell (${_shTotal}${_shHit ? ` · ${_shDmg.total} dmg` : ' · miss'})`;
                            this._combatBudget.action = 'used';
                            this._attackPhase = 'result';
                            this._attackRollPrep = null;
                            this.render(true);
                        } catch (e) { console.error('[AgentDevice 5.8.32] shell:', e); }
                        break;
                    }
                    // EXPLOSIVE (pg 174) — 10x10m blast on target square; if miss, GM picks where it lands
                    if (_fireMode === 'explosive') {
                        try {
                            const _expMsg = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #ff3366; border-radius: 3px;">
                              <div style="font-size: 0.9rem; color: #ff3366; font-weight: 700; letter-spacing: 2px; margin-bottom: 6px;">✸ EXPLOSIVE — 10×10m BLAST <span style="color:#888; font-size:0.6rem;">${wep.name}</span></div>
                              <div style="font-size: 0.65rem; color: #fff; margin-bottom: 4px;">Single damage roll applies to everyone (incl. terrain) in 10m×10m centered on target square</div>
                              <div style="font-size: 0.65rem; color: #ccc;">Targets with REF 8+ may individually dodge by beating your attack total with DEX+Evasion+1d10</div>
                              <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px;">If attack misses DV, GM picks where the blast actually lands (CPR pg 174).</div>
                            </div>`;
                            await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: _expMsg });
                        } catch (e) { console.error('[AgentDevice 5.8.29] explosive:', e); }
                    }
                    // AUTOFIRE (pg 173) — uses Autofire skill (not weapon's normal), separate range table, 2d6×beat-DV damage
                    let _afOverrideDV = null;
                    let _afSkillLvl = skillLvl;
                    let _afSkillName = skillName;
                    if (_fireMode === 'autofire') {
                        const _curMag = Number(wep.system?.magazine?.value ?? 0);
                        if (_curMag < 10) {
                            ui.notifications.warn(`${wep.name} needs 10 bullets for Autofire (has ${_curMag}).`);
                            break;
                        }
                        try { await wep.update({ 'system.magazine.value': _curMag - 10 }); } catch (e) {}
                        // Autofire skill replaces weapon's normal skill
                        const _autoSkillItem = actor.items.find(it => it.type === 'skill' && it.name?.toLowerCase() === 'autofire');
                        _afSkillLvl = Number(_autoSkillItem?.system?.level ?? 0);
                        _afSkillName = 'Autofire';
                        // Autofire range table (CPR pg 173) — 5 bands different from standard 8
                        try {
                            const _myT = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id);
                            const _tgtT = canvas?.tokens?.get(this._attackTarget);
                            if (_myT && _tgtT) {
                                const _dist = canvas.grid.measureDistance(_myT.center, _tgtT.center);
                                const _afBands = [6, 12, 25, 50, 100];
                                const _afTables = {
                                    smg:          [15, 13, 15, 20, 25],
                                    assaultrifle: [17, 16, 15, 13, 15],
                                    heavymachinegun: [17, 16, 15, 13, 15]
                                };
                                const _wtype = this._attackRollPrep?.weaponTypeKey || '';
                                const _table = _afTables[_wtype] || _afTables['assaultrifle'];
                                const _bi = _afBands.findIndex(b => _dist <= b);
                                if (_bi >= 0) _afOverrideDV = _table[_bi];
                                else _afOverrideDV = 25;  // beyond 100m, autofire ineffective but use highest
                            }
                        } catch (e) {}
                        // 5.8.32: actually APPLY the Autofire Range Table DV (pg 173). It was computed
                        // since 5.8.26 but never consumed — autofire resolved against the single-shot
                        // table. Replaces the DV only when the user hasn't hand-stepped it and the
                        // defender isn't dodging (evade roll already replaced dvOverride above).
                        if (_afOverrideDV !== null && this._attackRollPrep && !this._attackRollPrep.evadeActive
                            && this._attackRollPrep.dvOverride === this._attackRollPrep.autoDV) {
                            this._attackRollPrep.dvOverride = _afOverrideDV;
                            this._attackRollPrep.autoDV = _afOverrideDV;
                        }
                    }
                    // 5.8.32: single/aimed/explosive shots consume 1 round. Autofire/suppressive
                    // already burn 10; shell consumes its own; melee (magMax 0) skips. Bows/crossbows
                    // still fire the loaded arrow (they just never need the Reload Action, pg 173).
                    if (_fireMode !== 'autofire' && _magMax > 0) {
                        try { await wep.update({ 'system.magazine.value': Math.max(0, _magVal - 1) }); } catch (e) {}
                    }
                    const _useSkillLvl = _fireMode === 'autofire' ? _afSkillLvl : skillLvl;
                    const _useSkillName = _fireMode === 'autofire' ? _afSkillName : skillName;
                    const formula = `1d10x10 + ${statVal} + ${_useSkillLvl} + ${atkMod}${woundPenalty ? ' '+woundPenalty : ''}${_prepMod ? (_prepMod >= 0 ? ' + '+_prepMod : ' '+_prepMod) : ''}${_prepLuck ? ' + '+_prepLuck : ''}`;
                    try {
                        const roll = new Roll(formula);
                        await roll.evaluate({ async: true });
                        const firstDie = roll.dice?.[0]?.results?.[0]?.result;
                        // CPR pg 130: crit ONLY on natural 10 of first die.
                        const isCrit   = firstDie === 10;
                        const isFumble = firstDie === 1;
                        // 5.8.32: Critical Failure (pg 130) — roll another 1d10 and SUBTRACT it.
                        // (No chaining: a second 1 doesn't cascade.) Was display-only before.
                        let _fumbleSub = 0;
                        if (isFumble) {
                            const _fr = new Roll('1d10');
                            await _fr.evaluate({ async: true });
                            _fumbleSub = _fr.total;
                        }
                        const _finalTotal = roll.total - _fumbleSub;
                        this._attackRoll = {
                            total: _finalTotal,
                            fumbleSub: _fumbleSub,
                            formula,
                            isCrit, isFumble,
                            ref, skillLvl, atkMod,
                            weaponName: wep.name,
                            targetName: (canvas?.tokens?.get(this._attackTarget)?.name) || '?'
                        };
                        // 5.8.1: custom attack chat card showing rolled dice breakdown
                        // 5.8.38: footer shows THIS roll vs the DV actually in play
                        const _dvShown = (this._attackRollPrep && Number(this._attackRollPrep.dvOverride) > 0)
                            ? Number(this._attackRollPrep.dvOverride) : null;
                        const _firstDie = roll.dice?.[0]?.results?.[0]?.result ?? '?';
                        const _extraSum = (roll.dice?.[0]?.results || []).slice(1).reduce((a, r) => a + r.result, 0);
                        const _accent = isCrit ? '#22ddff' : (isFumble ? '#ff3366' : '#ff3366');
                        const _statLabel = isMelee ? 'DEX' : 'REF';
                        const flavor = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid ${_accent}; border-radius: 3px; box-shadow: 0 0 12px ${_accent}26;">
                          <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;">
                            <div style="font-size: 0.9rem; color: ${_accent}; font-weight: 700; letter-spacing: 2px; text-shadow: 0 0 6px ${_accent}80;">${wep.name.toUpperCase()} <span style="color: #888; font-size: 0.65rem; letter-spacing: 1px;">→ ${this._attackRoll.targetName}</span></div>
                            <div style="display:flex; gap:6px; align-items:center;">
                              ${_fireMode === 'autofire' ? '<span style="font-size:0.6rem; color:#ffaa00; letter-spacing:1.5px;">▦ AUTOFIRE</span>' : ''}
                              ${_fireMode === 'aimed-head' ? '<span style="font-size:0.6rem; color:#ffaa00; letter-spacing:1.5px;">◎ AIMED · HEAD</span>' : ''}
                              ${_fireMode === 'aimed-held' ? '<span style="font-size:0.6rem; color:#ffaa00; letter-spacing:1.5px;">◎ AIMED · HELD</span>' : ''}
                              ${_fireMode === 'aimed-leg'  ? '<span style="font-size:0.6rem; color:#ffaa00; letter-spacing:1.5px;">◎ AIMED · LEG</span>'  : ''}
                              ${isCrit ? '<span style="font-size: 0.65rem; color:#22ddff; letter-spacing: 1.5px;">★ CRIT</span>' : ''}
                              ${isFumble ? `<span style="font-size: 0.65rem; color:#ff3366; letter-spacing: 1.5px;">✕ FUMBLE −${_fumbleSub} (pg 130)</span>` : ''}
                            </div>
                          </div>
                          <div style="display: grid; grid-template-columns: repeat(5, 1fr); gap: 5px; font-size: 0.65rem; text-align: center; margin-bottom: 8px;">
                            <div style="padding: 5px 3px; background: rgba(255,51,102,0.05); border: 1px solid rgba(255,51,102,0.25); border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">ROLL</div><div style="font-size: 0.95rem; color: #fff; font-weight: 700;">${_firstDie}${_extraSum > 0 ? '+' + _extraSum : ''}</div></div>
                            <div style="padding: 5px 3px; background: rgba(255,51,102,0.05); border: 1px solid rgba(255,51,102,0.25); border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">${_statLabel}</div><div style="font-size: 0.95rem; color: #fff; font-weight: 700;">+${ref}</div></div>
                            <div style="padding: 5px 3px; background: rgba(255,51,102,0.05); border: 1px solid rgba(255,51,102,0.25); border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">${(_useSkillName||'SKILL').toUpperCase().slice(0,8)}</div><div style="font-size: 0.95rem; color: #fff; font-weight: 700;">+${_useSkillLvl}</div></div>
                            <div style="padding: 5px 3px; background: rgba(255,51,102,0.05); border: 1px solid rgba(255,51,102,0.25); border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">ATK</div><div style="font-size: 0.95rem; color: #fff; font-weight: 700;">+${atkMod}</div></div>
                            <div style="padding: 5px 3px; background: ${_accent}33; border: 1px solid ${_accent}; border-radius: 3px; box-shadow: inset 0 0 8px ${_accent}33;"><div style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">TOTAL</div><div style="font-size: 1.1rem; color: ${_accent}; font-weight: 800; text-shadow: 0 0 6px ${_accent}80;">${_finalTotal}</div></div>
                          </div>
                          <div style="display: flex; align-items: flex-start; gap: 6px; padding-top: 6px; border-top: 1px solid ${_accent}26;">
                            <span style="font-size: 0.5rem; color: ${_accent}; letter-spacing: 1.5px; white-space: nowrap; flex: 0 0 auto;">RULES</span>
                            <span style="font-size: 0.65rem; color: #ccc; font-style: italic;">${_finalTotal} vs ${_dvShown !== null ? `DV ${_dvShown}` : 'DV'} — must beat it, a tie misses (CPR pg ${isMelee ? '175' : '173'})</span>
                          </div>
                        </div>`;
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: flavor,
                            rolls: [roll],
                            type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5
                        });
                        // 1.7.0 — REACTIVE dodge: the attack is rolled + shown; NOW the defender may react
                        // (CPR — spend their Action to dodge after seeing they're under fire). Their Evasion
                        // becomes the DV the attack must beat, folded into dvOverride for the miss-gate below.
                        try {
                            this._attackAwaitingDodge = true;
                            const _dr = await this._resolveDodgeAfterRoll(wep, this._attackRoll.total);
                            if (_dr && _dr.dodged && this._attackRollPrep) {
                                this._attackRollPrep.dvOverride = Number(_dr.evasionTotal) || this._attackRollPrep.dvOverride;
                            }
                        } catch (e) { console.warn("[VirtualAgent] reactive dodge failed:", e); }
                        finally { this._attackAwaitingDodge = false; }
                        // 5.7.1: MISS: skip damage phase if attack total < auto-computed DV.
                        let _autoDV = null;
                        try {
                            const myTok = canvas?.tokens?.placeables?.find(t => t.actor?.id === actor.id);
                            const tgtTok = canvas?.tokens?.get(this._attackTarget);
                            if (myTok && tgtTok && Array.isArray(wep.system?.dvTable)) {
                                const dist = canvas.grid.measureDistance(myTok.center, tgtTok.center);
                                const bands = [6, 12, 25, 50, 100, 200, 400, 800];
                                const bi = bands.findIndex(b => dist <= b);
                                if (bi >= 0 && wep.system.dvTable[bi]) _autoDV = Number(wep.system.dvTable[bi]) || null;
                            }
                        } catch (e) {}
                        // 5.8.8: prep DV override wins if set
                        if (this._attackRollPrep && this._attackRollPrep.dvOverride > 0) _autoDV = this._attackRollPrep.dvOverride;
                        // 5.8.32: ties MISS — "If you beat the DV (Defender wins in a tie)" (pg 170/172)
                        if (_autoDV !== null && this._attackRoll.total <= _autoDV) {
                            this._attackRoll.didHit = false;
                            this._attackRoll.dvUsed = _autoDV;
                            const missTargetName = this._attackRoll.targetName;
                            const missTotal = this._attackRoll.total;
                            this._lastCombatAction = {
                                kind: 'attack', weaponName: wep.name,
                                targetName: missTargetName,
                                hitTotal: missTotal, damageTotal: 0,
                                isMiss: true, ts: Date.now()
                            };
                            this._spawnDamagePop('miss', 'MISS');
                            this._combatBudget.action = 'used';
                            this._combatMenu = 'main';
                            this._attackPhase = 'weapon';
                            this._attackWeapon = null;
                            this._attackTarget = null;
                            this._attackRoll = null;
                            this._attackRollPrep = null;
                            this.render(true);
                            ChatMessage.create({
                                speaker: ChatMessage.getSpeaker({ actor }),
                                content: `<div style="font-family: monospace; font-size: 0.75rem;"><strong style="color:#888;">${actor.name} → ${missTargetName} — MISS</strong><br><span style="color:#888; font-size: 0.65rem;">${missTotal} vs DV ${_autoDV}</span></div>`
                            });
                            break;
                        }
                        if (_autoDV !== null) this._attackRoll.dvUsed = _autoDV;
                        this._attackRoll.didHit = true;
                        // 5.7.8: auto-roll damage on hit — skip the manual button step
                        try {
                            // 5.8.22: sanitize damage formula. Truthy string "0" beat the || fallback before — explicit check now.
                            let dmgFormula = wep.system?.damage;
                            if (!dmgFormula || !String(dmgFormula).match(/\d+d\d+/)) {
                                console.warn(`[AgentDevice 5.8.22] ${wep.name} has no valid damage formula (got: ${JSON.stringify(dmgFormula)}); defaulting to 3d6`);
                                dmgFormula = '3d6';
                            }
                            // 5.8.26: AUTOFIRE damage override (CPR pg 173): 2d6 × beat-DV, capped by weapon mult (SMG=3, AR=4)
                            const _fireModeForDmg = this._attackRollPrep?.fireMode || _fireMode || 'single';
                            const _isAutofire = _fireModeForDmg === 'autofire';
                            const _isAimedHead = _fireModeForDmg === 'aimed-head';
                            const _isAimedLeg  = _fireModeForDmg === 'aimed-leg';
                            const _isAimedHeld = _fireModeForDmg === 'aimed-held';
                            let _autofireMult = 1;
                            if (_isAutofire) {
                                const _beatBy = Math.max(0, (this._attackRoll?.total ?? 0) - (this._attackRollPrep?.dvOverride ?? 13));
                                const _wt = this._attackRollPrep?.weaponTypeKey || '';
                                const _cap = (_wt === 'smg') ? 3 : (_wt === 'assaultrifle' || _wt === 'heavymachinegun') ? 4 : 3;
                                _autofireMult = Math.min(_beatBy, _cap);
                                if (_autofireMult <= 0) _autofireMult = 1;  // minimum 1 if we hit at all
                                dmgFormula = `2d6 * ${_autofireMult}`;
                            }
                            const dmgRoll = new Roll(dmgFormula);
                            await dmgRoll.evaluate({ async: true });
                            const sixes = (dmgRoll.dice?.[0]?.results || []).filter(r => r.result === 6).length;
                            const _ammo = this._attackRollPrep?.ammoType || 'basic';   // 1.4.0 ammo type for this shot
                            // 5.8.32: armor lookup MOVED ABOVE the crit determination. It used to sit
                            // after it, so the leg/mortal terms hit `armorSP` in its temporal dead zone
                            // → ReferenceError, swallowed by the outer catch → entire damage pipeline
                            // silently skipped for aimed-leg shots and hits on Mortally Wounded targets.
                            let armorSP = 0;
                            let _armorLocation = 'body';
                            try {
                                const tgtTok = canvas?.tokens?.get(this._attackTarget);
                                const tgtActor = tgtTok?.actor;
                                // 5.8.26: Aimed Shot to head uses head armor; everything else uses body (CPR pg 169, 186)
                                if (_isAimedHead) {
                                    armorSP = Number(tgtActor?.system?.externalData?.currentArmorHead?.value
                                        ?? tgtActor?.system?.externalData?.armor?.head
                                        ?? tgtActor?.system?.armor?.head ?? 0);
                                    _armorLocation = 'head';
                                } else {
                                    armorSP = Number(tgtActor?.system?.externalData?.currentArmorBody?.value
                                        ?? tgtActor?.system?.externalData?.armor?.body
                                        ?? tgtActor?.system?.armor?.body ?? 0);
                                }
                                // 1.3.1 — fallback for single items that cover BOTH locations (Body Weight
                                // Suit, Subdermal Armor): the system's per-location externalData can surface
                                // 0 SP for these, so the app applied full damage. Read the EQUIPPED armor
                                // items directly — current SP = sp − ablation at the hit location. Confirmed
                                // cyberpunk-red-core fields: system.equipped, system.is{Head,Body}Location,
                                // system.{head,body}Location.{sp,ablation}.
                                if (!(armorSP > 0)) {
                                    const _items = tgtActor?.items?.contents ?? Array.from(tgtActor?.items ?? []);
                                    for (const _it of _items) {
                                        if (_it?.type !== 'armor' || _it.system?.equipped !== 'equipped') continue;
                                        let _sp = 0;
                                        if (_armorLocation === 'head' && _it.system?.isHeadLocation) {
                                            _sp = Number(_it.system?.headLocation?.sp ?? 0) - Number(_it.system?.headLocation?.ablation ?? 0);
                                        } else if (_armorLocation === 'body' && _it.system?.isBodyLocation) {
                                            _sp = Number(_it.system?.bodyLocation?.sp ?? 0) - Number(_it.system?.bodyLocation?.ablation ?? 0);
                                        }
                                        if (_sp > armorSP) armorSP = _sp;
                                    }
                                }
                            } catch (e) {}
                            // 5.8.26: Aimed Shot to head DOUBLES damage past head SP (CPR pg 169)
                            let damageThrough = Math.max(0, dmgRoll.total - armorSP);
                            if (_isAimedHead) damageThrough = damageThrough * 2;
                            // 1.7.1 RULES FIX (verified vs CPR pg 344): Armor-Piercing does NOT halve SP or
                            // damage — that was a wrong earlier guess. Its ONLY effect is ablating 2 SP instead
                            // of 1 (handled in the ablation block below). Sleep deals NO damage; a DV13 Resist
                            // Torture/Drugs check is posted instead (CPR pg 344).
                            if (_ammo === 'sleep') damageThrough = 0;
                            // 5.8.2 CPR pg 187: Crit Injury ONLY from 2+ sixes. Attack crit just gives +1d10 to attack.
                            // 5.8.26: Aimed Shot to leg → forces the Broken Leg crit if damage got through (CPR pg 169);
                            // Aimed Shot to held item → drop item but no crit; Autofire double 6s → crit
                            // 5.8.28: Mortally Wounded targets suffer Critical Injury on every damaging hit (CPR pg 186)
                            const _autofireBothSixes = _isAutofire && sixes >= 2;
                            let _tgtMortal = false;
                            try {
                                const _tgtA = canvas?.tokens?.get(this._attackTarget)?.actor;
                                const _tgtHpV = Number(_tgtA?.system?.derivedStats?.hp?.value ?? _tgtA?.system?.hp?.value ?? 99);
                                _tgtMortal = _tgtHpV < 1;
                            } catch (e) {}
                            const _legCrit = _isAimedLeg && damageThrough > 0;
                            // 1.7.1 — Rubber ammunition cannot cause a Critical Injury (CPR pg 345)
                            const isCritDamage = ((sixes >= 2) || _autofireBothSixes || _legCrit || (_tgtMortal && damageThrough > 0)) && _ammo !== 'rubber';
                            // 5.8.2: Crit Injury +5 Bonus Damage direct to HP (pg 187) + armor ablation -1 SP (pg 186)
                            const bonusDmg = isCritDamage ? 5 : 0;
                            // 1.4.0 — Sleep never deals damage, even on a "crit" damage roll.
                            const damageAfterArmor = (_ammo === 'sleep') ? 0 : (damageThrough + bonusDmg);
                            // 5.8.23: route armor + HP updates via GM socket when attacker can't update target.
                            // Players hitting a GM-owned mook would otherwise get "User X lacks permission
                            // to update ActorDelta" because actor.update() blocks non-owners.
                            let _hpPreDamage = null;  // 5.8.33: pre-damage HP snapshot for the key-event cards below
                            try {
                                const _tgtTok = canvas?.tokens?.get(this._attackTarget);
                                const _tgtActor = _tgtTok?.actor;
                                if (_tgtActor) {
                                    const _canUpdate = game.user.isGM || (_tgtActor.testUserPermission?.(game.user, 'OWNER') ?? false);
                                    const _ablate = (damageThrough > 0 && armorSP > 0 && _ammo !== 'rubber');  // 1.7.1 — Rubber can't ablate (CPR pg 345)
                                    const _ablateBy = (_ammo === 'armorPiercing') ? 2 : 1;                    // 1.7.1 — AP ablates 2, not 1 (CPR pg 344)
                                    const _hpCur = Number(_tgtActor.system?.derivedStats?.hp?.value
                                        ?? _tgtActor.system?.hp?.value ?? 0);
                                    _hpPreDamage = _hpCur;
                                    // 1.7.1 — Rubber can't drop a target from above 1 HP to below 0; they're left at 1 (CPR pg 345)
                                    const _hpFloor = (_ammo === 'rubber' && _hpCur > 1) ? 1 : 0;
                                    const _hpNew = Math.max(_hpFloor, _hpCur - damageAfterArmor);
                                    if (_canUpdate) {
                                        // local update (GM, or player attacking their own actor)
                                        // 5.8.32: ablate the armor location that was actually hit —
                                        // head shots used to ablate BODY armor.
                                        if (_ablate) {
                                            if (_armorLocation === 'head') {
                                                if (_tgtActor.system?.externalData?.currentArmorHead !== undefined) {
                                                    await _tgtActor.update({ 'system.externalData.currentArmorHead.value': Math.max(0, armorSP - _ablateBy) });
                                                } else if (_tgtActor.system?.externalData?.armor?.head !== undefined) {
                                                    await _tgtActor.update({ 'system.externalData.armor.head': Math.max(0, armorSP - _ablateBy) });
                                                }
                                            } else if (_tgtActor.system?.externalData?.currentArmorBody !== undefined) {
                                                await _tgtActor.update({ 'system.externalData.currentArmorBody.value': Math.max(0, armorSP - _ablateBy) });
                                            } else if (_tgtActor.system?.externalData?.armor?.body !== undefined) {
                                                await _tgtActor.update({ 'system.externalData.armor.body': Math.max(0, armorSP - _ablateBy) });
                                            }
                                        }
                                        if (damageAfterArmor > 0) {
                                            if (_tgtActor.system?.derivedStats?.hp?.value !== undefined) {
                                                await _tgtActor.update({ 'system.derivedStats.hp.value': _hpNew });
                                            } else if (_tgtActor.system?.hp?.value !== undefined) {
                                                await _tgtActor.update({ 'system.hp.value': _hpNew });
                                            }
                                            console.log(`[AgentDevice 5.8.23] HP applied locally: ${_tgtActor.name} ${_hpCur} → ${_hpNew} (−${damageAfterArmor})`);
                                        }
                                    } else {
                                        // route to GM via socket
                                        const _gmOnline = game.users.some(u => u.isGM && u.active);
                                        if (!_gmOnline) {
                                            ui.notifications.error("No GM online — damage card posted but HP/armor not applied. Ask GM to log in.");
                                        } else {
                                            game.socket.emit("module.VirtualAgent", {
                                                action: "combatApplyDamage",
                                                targetUuid: _tgtActor.uuid,
                                                damageAmount: damageAfterArmor,
                                                ablateArmor: _ablate,
                                                armorSP,
                                                ablateBy: _ablateBy,                   // 1.7.1 — AP ablates 2, not 1 (CPR pg 344)
                                                rubberNonLethal: (_ammo === 'rubber'), // 1.7.1 — Rubber floors HP at 1 (CPR pg 345)
                                                armorLocation: _armorLocation,  // 5.8.32: head shots ablate head armor
                                                attackerName: actor?.name || game.user.name
                                            });
                                            console.log(`[AgentDevice 5.8.23] HP apply routed to GM: ${_tgtActor.name} −${damageAfterArmor}`);
                                        }
                                    }
                                }
                            } catch (e) { console.warn('[AgentDevice 5.8.23] damage apply failed:', e); }
                            // 5.8.26: Aimed Shot to held item — if any damage got through body armor, target drops what they're holding (CPR pg 169)
                            if (_isAimedHeld && damageThrough > 0) {
                                try {
                                    const _tgtN = canvas?.tokens?.get(this._attackTarget)?.actor?.name || 'Target';
                                    const _hf = `<div style="font-family: monospace; padding: 8px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid #ffaa00; border-radius: 3px;">
                                      <div style="font-size: 0.85rem; color: #ffaa00; font-weight: 700; letter-spacing: 2px; margin-bottom: 4px;">◎ HELD ITEM DROPPED</div>
                                      <div style="font-size: 0.65rem; color: #fff;">${_tgtN} drops what they were holding.</div>
                                      <div style="font-size: 0.62rem; color: #bbb; margin-top: 4px;">Aimed Shot · held item · damage got through body armor (CPR pg 169)</div>
                                    </div>`;
                                    ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: _hf });
                                } catch (e) {}
                            }
                            // 5.8.24: post key-event chat cards (CRIT INJURY, DEATH) — broadcast to all
                            try {
                                const _tgt = canvas?.tokens?.get(this._attackTarget)?.actor;
                                if (_tgt) {
                                    // 5.8.33: use the PRE-damage snapshot from the apply block. The local
                                    // path has already awaited the HP update by this point, so a fresh read
                                    // shows POST-damage HP — the 0-HP transition test below could never pass
                                    // and GM-local killing blows never posted the MORTALLY WOUNDED card.
                                    // Socket path may or may not have applied yet; the snapshot covers both.
                                    const _hpBefore = _hpPreDamage ?? Number(_tgt.system?.derivedStats?.hp?.value ?? _tgt.system?.hp?.value ?? 0);
                                    const _hpPredicted = Math.max(0, _hpBefore - damageAfterArmor);
                                    // CRITICAL INJURY card (2+ sixes per CPR pg 187)
                                    if (isCritDamage) {
                                        // 5.8.25: drop the placeholder text card — the auto-roll card supersedes it.
                                        // GM rolls the table directly; player attackers emit socket so GM rolls server-side.
                                        // 5.8.32: head table for aimed-head (stale TODO — head was wired in
                                        // 5.8.26), forced Broken Leg for aimed-leg (pg 169), and DSP bump
                                        // for damaged-while-mortal (pg 186) all ride the payload now.
                                        const _ciPayload = {
                                            targetUuid: _tgt.uuid,
                                            targetName: _tgt.name,
                                            attackerName: actor?.name || game.user.name,
                                            location: _isAimedHead ? 'head' : 'body',
                                            forcedInjury: _legCrit ? 'Broken Leg' : null,
                                            bumpDeathSavePenalty: _tgtMortal && damageThrough > 0
                                        };
                                        if (game.user.isGM) {
                                            await this._rollCriticalInjury(_ciPayload);
                                        } else {
                                            // route to GM via socket; GM-side handler will call _rollCriticalInjury
                                            game.socket.emit("module.VirtualAgent", { action: "combatRollCriticalInjury", ..._ciPayload });
                                        }
                                    }
                                    // DEATH card (HP transitions to 0 — Mortally Wounded per CPR pg 186)
                                    if (_hpBefore > 0 && _hpPredicted <= 0) {
                                        const _dFlavor = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.95); border-left: 3px solid #ff3366; border-radius: 3px; box-shadow: 0 0 16px rgba(255,51,102,0.4);">
                                          <div style="font-size: 1.05rem; color: #ff3366; font-weight: 800; letter-spacing: 3px; text-shadow: 0 0 8px #ff3366; margin-bottom: 6px;">☠ MORTALLY WOUNDED</div>
                                          <div style="font-size: 0.75rem; color: #fff; margin-bottom: 4px;">${_tgt.name} is dropped at 0 HP</div>
                                          <div style="font-size: 0.65rem; color: #ccc;">Must make Death Save each turn until stabilized (CPR pg 186)</div>
                                        </div>`;
                                        ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content: _dFlavor });
                                    }
                                }
                            } catch (e) { console.warn('[AgentDevice 5.8.24] key-event chat card failed:', e); }
                            // 1.4.0 — Sleep ammo: no damage; post the DV13 Resist Torture/Drugs check.
                            if (_ammo === 'sleep') {
                                try {
                                    const _slpTgt = canvas?.tokens?.get(this._attackTarget)?.actor;
                                    ChatMessage.create({
                                        speaker: ChatMessage.getSpeaker({ actor }),
                                        content: `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.95); border-left: 3px solid #aa88ff; border-radius: 3px;">
                                          <div style="font-size: 0.95rem; color: #aa88ff; font-weight: 800; letter-spacing: 2px;">&#128564; SLEEP ROUND</div>
                                          <div style="font-size: 0.72rem; color: #fff; margin-top: 4px;">${_slpTgt?.name || 'Target'} takes <strong>no damage</strong> — must make a <strong style="color:#aa88ff;">DV13 Resist Torture/Drugs</strong> check or be knocked out.</div>
                                        </div>`
                                    });
                                } catch (e) {}
                            }
                            this._attackDamage = {
                                total: damageAfterArmor,
                                rawTotal: dmgRoll.total,
                                damageThrough,
                                bonusDmg,
                                armorSP,
                                formula: dmgFormula,
                                isCritDamage,
                                sixes,
                                weaponName: wep.name,
                                targetName: this._attackRoll?.targetName || '?',
                                ammoType: _ammo,                       // 1.4.0
                                ammoNote: this._ammoRuleNote(_ammo),   // 1.4.0
                                ammoIsSleep: _ammo === 'sleep'         // 1.4.0
                            };
                            // 5.8.1: custom damage card with dice breakdown + armor subtraction
                            // 5.8.38: the RULES footer used to print the static rule ("2+ sixes -> Crit")
                            // which players read as a RESULT ("but I rolled 4+3+2?"). It now reports
                            // what THIS roll did and only cites the threshold as context.
                            let _critWhy = '';
                            if (sixes >= 2 || _autofireBothSixes) _critWhy = `${sixes} sixes → CRITICAL INJURY (+5 dmg)`;
                            else if (_legCrit) _critWhy = 'Aimed Shot · leg → Broken Leg CRITICAL INJURY (+5 dmg)';
                            else if (_tgtMortal && damageThrough > 0) _critWhy = 'target Mortally Wounded → crit on any damage (+5 dmg)';
                            const _sixesTxt = _critWhy || `${sixes === 1 ? '1 six' : 'no sixes'} this roll (2+ sixes would inflict a Critical Injury)`;
                            const _armorTxt = armorSP <= 0 ? 'target has no armor SP'
                                : (damageThrough > 0 && _ammo !== 'rubber'
                                    ? `armor ablates: SP ${armorSP} → ${Math.max(0, armorSP - ((_ammo === 'armorPiercing') ? 2 : 1))}`
                                    : 'armor not ablated');
                            const _rulesSummary = `${_sixesTxt} · ${_armorTxt} (CPR pg 186-187)`;
                            const _dmgDice = (dmgRoll.dice?.[0]?.results || []).map(r => r.result).join(' + ');
                            const _dmgAccent = isCritDamage ? '#ff3366' : '#ffaa00';
                            const dmgFlavor = `<div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid ${_dmgAccent}; border-radius: 3px; box-shadow: 0 0 12px ${_dmgAccent}26;">
                              <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 6px;">
                                <div style="font-size: 0.9rem; color: ${_dmgAccent}; font-weight: 700; letter-spacing: 2px; text-shadow: 0 0 6px ${_dmgAccent}80;">DAMAGE <span style="color: #888; font-size: 0.6rem; letter-spacing: 1px;">${wep.name}</span></div>
                                ${isCritDamage ? '<span style="font-size: 0.65rem; color:#ff3366; letter-spacing: 1.5px;">★ CRIT INJURY</span>' : ''}
                              </div>
                              <div style="font-size: 0.65rem; color: #ccc; margin-bottom: 8px;">${dmgFormula} → ${this._attackDamage.targetName}</div>
                              <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 5px; font-size: 0.65rem; text-align: center; margin-bottom: 8px;">
                                <div style="padding: 5px 3px; background: rgba(255,170,0,0.05); border: 1px solid rgba(255,170,0,0.25); border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_dmgAccent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">DICE</div><div style="font-size: 0.95rem; color: #fff; font-weight: 700;">${_dmgDice}</div></div>
                                <div style="padding: 5px 3px; background: rgba(255,170,0,0.05); border: 1px solid rgba(255,170,0,0.25); border-radius: 3px;"><div style="font-size: 0.5rem; color: ${_dmgAccent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">ARMOR SP</div><div style="font-size: 0.95rem; color: #fff; font-weight: 700;">−${armorSP}</div></div>
                                <div style="padding: 5px 3px; background: ${_dmgAccent}33; border: 1px solid ${_dmgAccent}; border-radius: 3px; box-shadow: inset 0 0 8px ${_dmgAccent}33;"><div style="font-size: 0.5rem; color: ${_dmgAccent}; letter-spacing: 1.5px; white-space: nowrap; overflow: hidden;">DEALT</div><div style="font-size: 1.15rem; color: ${_dmgAccent}; font-weight: 800; text-shadow: 0 0 6px ${_dmgAccent}80;">${damageAfterArmor}</div></div>
                              </div>
                              ${isCritDamage ? `<div style="font-size: 0.65rem; color: #ff3366; margin-bottom: 6px;">⟶ +5 Bonus Damage included (CPR pg 187)</div>` : ''}
                              <div style="display: flex; align-items: flex-start; gap: 6px; padding-top: 6px; border-top: 1px solid ${_dmgAccent}26;">
                                <span style="font-size: 0.5rem; color: ${_dmgAccent}; letter-spacing: 1.5px; white-space: nowrap; flex: 0 0 auto;">RULES</span>
                                <span style="font-size: 0.65rem; color: #ccc; font-style: italic;">${_rulesSummary}</span>
                              </div>
                            </div>`;
                            await ChatMessage.create({
                                speaker: ChatMessage.getSpeaker({ actor }),
                                content: dmgFlavor,
                                rolls: [dmgRoll],
                                type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5
                            });
                            this._spawnDamagePop(isCritDamage ? 'crit' : 'damage', String(damageAfterArmor));
                        } catch (e) { console.error('AgentDevice 5.7.8 auto-damage:', e); }
                        // Skip the manual ROLL DAMAGE phase — straight to result.
                        this._attackPhase = 'result';
                        this.render(true);
                    } catch (e) {
                        console.error("AgentDevice 5.6.2 attack-roll:", e);
                        ui.notifications.error("Attack roll failed — see console.");
                    }
                    break;
                }
                case 'combat-attack-finish': {
                    // 5.7.1: capture echo BEFORE wiping sub-flow state.
                    if (this._attackRoll && this._attackDamage) {
                        this._lastCombatAction = {
                            kind: 'attack',
                            weaponName: this._attackRoll.weaponName,
                            targetName: this._attackDamage.targetName || this._attackRoll.targetName,
                            hitTotal:    this._attackRoll.total,
                            damageTotal: this._attackDamage.total,
                            isCrit:      this._attackRoll.isCrit || this._attackDamage.isCritDamage,
                            ts: Date.now()
                        };
                    }
                    this._combatBudget.action = 'used';
                    this._combatMenu = 'main';
                    this._attackPhase = 'weapon';
                    this._attackWeapon = null;
                    this._attackTarget = null;
                    this._attackRoll = null;
                    this._attackDamage = null;
                    this._attackRollPrep = null;  // 5.8.8
                    this.render(true);
                    break;
                }
                // ── 5.6.0 SKILLS app actions ──
                // 5.6.1: real CPR skill roll. Formula: 1d10 + stat + level.
                // Critical handling: 10 explodes (+1d10), 1 fumbles (-1d10).
                // Roll posts to chat with skill name, stat, level breakdown.
                case 'skill-roll': {
                    // 5.8.6: opens prep dialog. Real roll happens in skill-prep-execute.
                    const btn = ev.currentTarget;
                    const skillName = btn.dataset.skillName || '?';
                    const statKey   = btn.dataset.statKey || '';
                    const skillId   = btn.dataset.skillId || '';
                    const actor     = this._resolveSkillsActor();
                    // 1.8.2 diagnostic — log every tap so "clicks don't roll" reports localize themselves
                    console.log(`[VirtualAgent skills] tap "${skillName}" | id: ${skillId} | actor: ${actor?.name || 'NULL'} | item found: ${!!actor?.items?.get?.(skillId)}`);
                    if (!actor) { ui.notifications.warn("No active character."); break; }
                    const skill = actor.items.get(skillId);
                    if (!skill) { ui.notifications.warn(`${skillName}: skill item not found.`); break; }
                    const stat = Number(actor.system?.stats?.[statKey]?.value ?? 0);
                    const lvl  = Number(skill.system?.level ?? 0);
                    this._skillRollPrep = { skillId, name: skillName, statKey, stat, lvl, modifier: 0, luckSpent: 0, _customDraft: 0 };
                    this.render(true);
                    break;
                }
                case 'skill-prep-cancel': { this._skillRollPrep = null; this.render(true); break; }
                case 'skill-prep-mod-step': {
                    if (!this._skillRollPrep) break;
                    this._skillRollPrep.modifier += Number(ev.currentTarget.dataset.delta || 0);
                    this.render(true); break;
                }
                case 'skill-prep-mod-add': {
                    if (!this._skillRollPrep) break;
                    this._skillRollPrep.modifier += Number(ev.currentTarget.dataset.modValue || 0);
                    this.render(true); break;
                }
                case 'skill-prep-luck-step': {
                    if (!this._skillRollPrep) break;
                    const _act = this._resolveSkillsActor();
                    const _maxLuck = Number(_act?.system?.stats?.luck?.value ?? 0);
                    const _d = Number(ev.currentTarget.dataset.delta || 0);
                    this._skillRollPrep.luckSpent = Math.max(0, Math.min(_maxLuck, this._skillRollPrep.luckSpent + _d));
                    this.render(true); break;
                }
                case 'skill-prep-mod-reset': {
                    if (!this._skillRollPrep) break;
                    this._skillRollPrep.modifier = 0; this._skillRollPrep.luckSpent = 0;
                    this.render(true); break;
                }
                case 'skill-prep-execute': {
                    if (!this._skillRollPrep) break;
                    const prep = this._skillRollPrep;
                    const actor = this._resolveSkillsActor();
                    // 1.8.2 diagnostic — confirms the ROLL button actually fired
                    console.log(`[VirtualAgent skills] ROLL tapped | skill: ${prep?.name} | actor: ${actor?.name || 'NULL'}`);
                    if (!actor) { this._skillRollPrep = null; this.render(true); break; }
                    const skillName = prep.name;
                    const statKey = prep.statKey;
                    const skillId = prep.skillId;
                    const skill = actor.items.get(skillId);
                    const stat = prep.stat;
                    const lvl = prep.lvl;
                    // CPR core: 1d10x10 (explode on 10), 1 → fumble (-1d10).
                    // We use a simple exploding-on-10 implementation that mirrors
                    // CPR's `1d10cp` formula without depending on its custom term.
                    // 5.8.6: include user-set modifier + LUCK spend from the prep dialog.
                    const mod = prep.modifier || 0;
                    const luck = prep.luckSpent || 0;
                    const formula = `1d10x10 + ${stat} + ${lvl}${mod ? (mod >= 0 ? ' + '+mod : ' '+mod) : ''}${luck ? ' + '+luck : ''}`;
                    try {
                        const roll = new Roll(formula);
                        await roll.evaluate({ async: true });
                        // Detect critical (any die rolled 10) and fumble (first die = 1).
                        const firstDie = roll.dice?.[0]?.results?.[0]?.result;
                        // 5.8.2 CPR pg 130: crit ONLY on natural 10 of first die.
                        const isCrit   = firstDie === 10;
                        const isFumble = firstDie === 1;
                        let bonus = '';
                        // (Note: wound penalty for skill rolls is included via the prep dialog modifier.
                        // Player should add it manually via QUICK MODIFIERS or +/− stepper. CPR pg 186.)
                        if (isFumble) {
                            const fumble = new Roll('1d10'); await fumble.evaluate({ async: true });
                            const newTotal = roll.total - fumble.total;
                            bonus = `<div style="color:#ff3366; font-family: monospace; font-size: 0.7rem; margin-top: 4px;">FUMBLE — extra 1d10 = ${fumble.total} → adjusted total <strong>${newTotal}</strong></div>`;
                        }
                        // 5.7.7: replaced raw roll.toMessage (which shows "1d10x10 + ..." formula)
                        // with a custom chat card that shows the rolled d10 + bonus breakdown in plain language.
                        const firstDieResult = roll.dice?.[0]?.results?.[0]?.result ?? '?';
                        // For exploding rolls, sum any extra dice past the first
                        const extraDiceTotal = (roll.dice?.[0]?.results || []).slice(1).reduce((a, r) => a + r.result, 0);
                        const diceTotal = firstDieResult + extraDiceTotal;
                        const adjustedTotal = isFumble ? roll.total - (typeof bonus === 'string' && bonus.includes('adjusted') ? Number(bonus.match(/<strong>(-?\d+)<\/strong>/)?.[1] || roll.total) : roll.total) : roll.total;
                        const finalTotal = isFumble && /adjusted total/.test(bonus) ? Number(bonus.match(/<strong>(-?\d+)<\/strong>/)?.[1] || roll.total) : roll.total;
                        const accentColor = isCrit ? '#22ddff' : (isFumble ? '#ff3366' : '#22ddff');
                        const card = `
                            <div style="font-family: monospace; padding: 10px 12px; background: rgba(5,5,16,0.92); border-left: 3px solid ${accentColor}; border-radius: 3px; box-shadow: 0 0 12px rgba(34,221,255,0.15);">
                              <div style="display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px;">
                                <div style="font-size: 1rem; color: ${accentColor}; font-weight: 700; letter-spacing: 2px; text-shadow: 0 0 6px ${accentColor}80;">${skillName.toUpperCase()}</div>
                                ${isCrit ? '<span style="font-size: 0.65rem; color:#22ddff; letter-spacing: 1.5px;">★ CRIT</span>' : ''}
                                ${isFumble ? '<span style="font-size: 0.65rem; color:#ff3366; letter-spacing: 1.5px;">✕ FUMBLE</span>' : ''}
                              </div>
                              <div style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; font-size: 0.7rem; text-align: center; margin-bottom: 8px;">
                                <div style="padding: 5px 3px; background: rgba(34,221,255,0.05); border: 1px solid rgba(34,221,255,0.25); border-radius: 3px;">
                                  <div style="font-size: 0.5rem; color: #22ddff; letter-spacing: 1.5px;">ROLL</div>
                                  <div style="font-size: 1rem; color: #fff; font-weight: 700;">${firstDieResult}${extraDiceTotal > 0 ? '+' + extraDiceTotal : ''}</div>
                                </div>
                                <div style="padding: 5px 3px; background: rgba(34,221,255,0.05); border: 1px solid rgba(34,221,255,0.25); border-radius: 3px;">
                                  <div style="font-size: 0.5rem; color: #22ddff; letter-spacing: 1.5px;">${String(statKey).toUpperCase()}</div>
                                  <div style="font-size: 1rem; color: #fff; font-weight: 700;">+${stat}</div>
                                </div>
                                <div style="padding: 5px 3px; background: rgba(34,221,255,0.05); border: 1px solid rgba(34,221,255,0.25); border-radius: 3px;">
                                  <div style="font-size: 0.5rem; color: #22ddff; letter-spacing: 1.5px;">LEVEL</div>
                                  <div style="font-size: 1rem; color: #fff; font-weight: 700;">+${lvl}</div>
                                </div>
                                <div style="padding: 5px 3px; background: rgba(34,221,255,0.18); border: 1px solid ${accentColor}; border-radius: 3px; box-shadow: inset 0 0 8px rgba(34,221,255,0.2);">
                                  <div style="font-size: 0.5rem; color: ${accentColor}; letter-spacing: 1.5px;">TOTAL</div>
                                  <div style="font-size: 1.15rem; color: ${accentColor}; font-weight: 800; text-shadow: 0 0 6px ${accentColor}80;">${finalTotal}</div>
                                </div>
                              </div>
                              ${isFumble && bonus ? `<div style="font-size: 0.6rem; color: #ff3366; margin-top: 6px;">⟶ Fumble penalty applied to total</div>` : ''}
                              <div style="display: flex; align-items: flex-start; gap: 6px; padding-top: 6px; border-top: 1px solid rgba(34,221,255,0.15);">
                                <span style="font-size: 0.5rem; color: #22ddff; letter-spacing: 1.5px; white-space: nowrap; flex: 0 0 auto;">RULES</span>
                                <span style="font-size: 0.65rem; color: #ccc; font-style: italic;">${isCrit ? 'natural 10 → CRIT, second d10 added' : isFumble ? 'natural 1 → FUMBLE, second d10 subtracted' : `first die ${firstDie} — crit needs a natural 10, fumble a natural 1`} (CPR pg 130)</span>
                              </div>
                            </div>`;
                        await ChatMessage.create({
                            speaker: ChatMessage.getSpeaker({ actor }),
                            content: card,
                            rolls: [roll],
                            type: CONST.CHAT_MESSAGE_TYPES?.ROLL ?? 5
                        });
                        console.log(`[VirtualAgent skills] roll posted to chat | ${skillName}: ${roll.total}`);
                        // 5.7.1: history + shrink + pop.
                        this._skillRollHistory.unshift({ name: skillName, total: roll.total, isCrit, isFumble, ts: Date.now() });
                        if (this._skillRollHistory.length > 5) this._skillRollHistory.pop();
                        this._skillsShrunk = true;
                        this._spawnDamagePop(isCrit ? 'crit' : (isFumble ? 'damage' : 'item'), String(roll.total));
                        // 5.8.6: close prep dialog
                        this._skillRollPrep = null;
                        this.render(true);
                    } catch (e) {
                        console.error("AgentDevice 5.6.1 skill-roll:", e);
                        ui.notifications.error(`${skillName} roll failed — see console.`);
                        this._skillRollPrep = null;
                    }
                    break;
                }

                // 5.6.1: SKILLS search filter — live as user types.

                // 5.8.0: context-aware top-left back button for COMBAT view.
                // In sub-flows: pops one phase. At sub-flow root: returns to combat main. In main: back to home.
                case 'combat-header-back': {
                    // 5.8.36: back inside the MOVE/RUN picker cancels the picker and returns to
                    // the combat menu. It used to fall through to back-to-home with _movePending
                    // still set, so re-entering COMBAT re-rendered the picker — soft-lock.
                    if (this._movePending) {
                        this._movePending = null;
                        this.render(true); break;
                    }
                    if (this._combatMenu === 'more') {
                        if (this._morePendingAction) {
                            // Step back from target picker to MORE menu
                            this._morePendingAction = null;
                        } else {
                            this._combatMenu = 'main';
                        }
                        this.render(true); break;
                    }
                    if (this._combatMenu === 'item') {
                        if (this._itemPhase === 'result') { this._itemPhase = 'pick'; }
                        else { this._combatMenu = 'main'; this._itemPhase = 'pick'; this._itemSelected = null; this._itemResult = null; }
                        this.render(true); break;
                    }
                    if (this._combatMenu === 'attack') {
                        const flow = ['weapon', 'target', 'roll', 'damage', 'result'];
                        const idx = flow.indexOf(this._attackPhase);
                        if (idx <= 0) {
                            this._combatMenu = 'main'; this._attackPhase = 'weapon';
                            this._attackWeapon = null; this._attackTarget = null;
                            this._attackRoll = null; this._attackDamage = null;
                        } else {
                            this._attackPhase = flow[idx - 1];
                            if (flow[idx - 1] === 'weapon') this._attackWeapon = null;
                            if (flow[idx - 1] === 'target') this._attackTarget = null;
                        }
                        this.render(true); break;
                    }
                    // Main state — fall through to back-to-home behavior
                    this.currentView = 'home'; this.activeContactId = null; this.render(true);
                    break;
                }

                case 'back-to-home':
                    this.currentView = 'home'; this.activeContactId = null; this.render(true);
                    break;

                case 'back-to-contacts':
                    this.currentView = 'chat'; this.activeContactId = null; this.showEmojiPicker = false; this.render(true);
                    break;

                case 'toggle-emoji-picker':
                    this.showEmojiPicker = !this.showEmojiPicker;
                    this.render(true);
                    break;

                case 'insert-emoji': {
                    const emoji = $(ev.currentTarget).data('emoji');
                    const cInput = html.find('#agent-chat-input');
                    cInput.val(cInput.val() + emoji);
                    cInput.focus();
                    break;
                }

                case 'emoji-set-category': {
                    // Patch4.8: switch emoji picker category. Click a tab,
                    // the grid below swaps to that category's set.
                    const cat = $(ev.currentTarget).data('category');
                    this._emojiCategory = String(cat || "react");
                    this.render(true);
                    break;
                }


                case 'toggle-attach-picker': {
                    // Patch4.8: show/hide the attachment template picker.
                    this.showAttachPicker = !this.showAttachPicker;
                    this.render(true);
                    break;
                }

                case 'set-attach-kind': {
                    // Patch4.8: switch attachment type (photo/video/audio).
                    const kind = String($(ev.currentTarget).data('kind') || "photo");
                    this._attachKind = kind;
                    this.render(true);
                    break;
                }

                case 'send-attachment': {
                    // Patch4.8: post an attachment-template card into the
                    // current thread. Stored as a normal Agent message with a
                    // `attachment: {kind, desc}` flag block; the chat
                    // decoration path reads it and renders the styled card.
                    if (!this.activeContactId) { ui.notifications.warn("Agent: Open a thread first."); return; }
                    const desc = (html.find('#attach-desc').val() || "").trim();
                    if (!desc) { ui.notifications.warn("Agent: Add a description for the attachment."); return; }
                    const kind = this._attachKind || "photo";
                    const contacts = this._getContacts();
                    const threadContact = contacts.find(c => c.id === this.activeContactId);
                    const isNpcThread = this.activeContactId?.startsWith("npc_");
                    const speakerAlias = (game.user.isGM && isNpcThread && threadContact)
                        ? (threadContact.originalName || threadContact.name)
                        : (game.user.name + " (Agent)");
                    const npcOverrideName = (game.user.isGM && isNpcThread && threadContact) ? (threadContact.originalName || threadContact.name) : undefined;
                    // 5.5.27 (live-Foundry screenshot): cross-user avatar resolution.
                    // When a PLAYER creates an NPC contact and uploads its
                    // avatar, the GM only sees the contact via the switchboard
                    // auto-build path in _getContacts() (no avatar field). The
                    // GM's outgoing attachment then went out with overrideAvatar
                    // undefined and the player's bubble fell back to the
                    // default icon. Scan every user's customContacts for the
                    // matching npc_* id and prefer the entry that has an
                    // avatar set.
                    let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar) ? threadContact.avatar : null;
                    if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
                        for (const u of game.users) {
                            const lst = u.getFlag("VirtualAgent", "customContacts") || [];
                            const m = lst.find(c => c.id === this.activeContactId);
                            if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
                        }
                    }
                    const npcOverrideAvatar = _resolvedNpcAvatar || undefined;
                    // Content is a placeholder string; the real render comes
                    // from the attachment flag block in getData chat-decoration.
                    const placeholderText = `[${kind.toUpperCase()}] ${desc}`;
                    const messageData = {
                        content: placeholderText,
                        speaker: { alias: speakerAlias },
                        flags: {
                            VirtualAgent: {
                                isAgentMessage: true,
                                threadId: this.activeContactId,
                                overrideName: npcOverrideName,
                                overrideAvatar: npcOverrideAvatar,
                                targetName: threadContact?.name,
                                attachment: { kind, desc: desc.slice(0, 500) }
                            }
                        }
                    };
                    // Same whisper routing as a regular message.
                    if (this.activeContactId !== 'party_group_chat') {
                        if (this.activeContactId?.startsWith("pcgroup_") || threadContact?.isCustomGroup) {
                            const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                            const targets = new Set(gmIds);
                            targets.add(game.user.id);
                            const members = Array.isArray(threadContact?.members) ? threadContact.members : [];
                            for (const m of members) {
                                if (m.startsWith("player:")) targets.add(m.slice("player:".length));
                            }
                            messageData.whisper = Array.from(targets);
                        } else if (game.users.get(this.activeContactId)) {
                            messageData.whisper = [this.activeContactId];
                        } else if (isNpcThread) {
                            if (game.user.isGM) {
                                const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                                const targets = new Set(gmIds);
                                const tList = Array.isArray(threadContact?.targetUserIds) ? threadContact.targetUserIds : [];
                                for (const uid of tList) targets.add(uid);
                                if (threadContact?.ownerId) targets.add(threadContact.ownerId);
                                messageData.whisper = Array.from(targets);
                            } else {
                                messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                            }
                        } else if (!game.user.isGM) {
                            messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                        }
                    }
                    this.showAttachPicker = false;
                    html.find('#attach-desc').val("");
                    if (this._composerDrafts) delete this._composerDrafts['attach-desc'];
                    await ChatMessage.create(messageData);
                    this.render(true);
                    break;
                }

                case 'open-new-group': {
                    // Patch4.8: open the new-group modal.
                    this.showNewGroup = true;
                    this.render(true);
                    break;
                }

                case 'cancel-new-group': {
                    this.showNewGroup = false;
                    if (this._composerDrafts) delete this._composerDrafts['new-group-name'];
                    this.render(true);
                    break;
                }

                case 'confirm-new-group': {
                    // Patch4.8: build the group. Members are tagged "player:USERID"
                    // or "npc:NPCID" via the checkbox values. We store the group
                    // as a customContact with `isGroup: true` and a `members`
                    // array. Messages sent into this thread route to all member
                    // users via whisper (the chat handler reads `members` to
                    // build the whisper list).
                    const name = (html.find('#new-group-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Agent: Group name required."); return; }
                    const members = [];
                    html.find('.new-group-member:checked').each((_, el) => members.push(String(el.value || "")));
                    if (members.length < 1) { ui.notifications.warn("Agent: Pick at least one participant."); return; }
                    const groupId = `pcgroup_${foundry.utils.randomID()}`;
                    const newGroup = {
                        id: groupId,
                        name,
                        isPlayer: false,
                        isGroup: true,
                        isCustomGroup: true,
                        members,           // ["player:abc","npc:npc_xyz",...]
                        ownerUserId: game.user.id,
                        avatar: ""
                    };
                    // Push to creator's contacts (always own-user — no perms issue).
                    const mine = game.user.getFlag("VirtualAgent", "customContacts") || [];
                    mine.push(newGroup);
                    await game.user.setFlag("VirtualAgent", "customContacts", mine);
                    // Patch5.0.1 (Gotto): if creator is the GM, push the group
                    // entry directly onto every player member's customContacts.
                    // If creator is a PLAYER, they don't have permission to
                    // setFlag on other users — emit a socket event so the GM
                    // does it on their behalf. Same flow as the existing NPC
                    // contact distribution.
                    if (game.user.isGM) {
                        for (const m of members) {
                            if (!m.startsWith("player:")) continue;
                            const uid = m.slice("player:".length);
                            const u = game.users.get(uid);
                            if (!u || u.id === game.user.id) continue;
                            const theirs = u.getFlag("VirtualAgent", "customContacts") || [];
                            if (!theirs.some(c => c.id === groupId)) {
                                theirs.push({ ...newGroup });
                                await u.setFlag("VirtualAgent", "customContacts", theirs);
                            }
                        }
                    } else {
                        // Player path — request GM relay.
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) {
                            ui.notifications.warn("Agent: No GM online to authorize the group invitation — group created for you only.");
                        } else {
                            game.socket.emit("module.VirtualAgent", {
                                action: "groupInviteRelay",
                                group: newGroup,
                                requestingUserId: game.user.id
                            });
                        }
                    }
                    this.showNewGroup = false;
                    this.activeContactId = groupId;
                    this.currentView = 'chat-thread';
                    if (this._composerDrafts) delete this._composerDrafts['new-group-name'];
                    ui.notifications.info(`Agent: Group "${name}" created with ${members.length} member(s).`);
                    this.render(true);
                    break;
                }

                case 'post-social': {
                    const category = (html.find('#social-post-category').val() || "Post").trim() || "Post";
                    const text = (html.find('#social-post-text').val() || "").trim();
                    if (!text) { ui.notifications.warn("Virtual Agent: Post text required."); return; }
                    // Patch4.7 (Gotto Goho): GM persona override — when the GM fills
                    // in the optional "Post AS" field, the post is attributed to
                    // that NPC name instead of "Gamemaster". Players still post
                    // under their handle as before.
                    const personaAs = game.user.isGM ? (html.find('#social-post-as').val() || "").trim() : "";
                    // Patch5.5: GM-only Screamsheet toggle. When checked, the post
                    // renders as a styled card (RED-era pirate broadsheet) instead
                    // of a regular feed item. Flag is set false by default so
                    // existing posts are unaffected.
                    const isScreamsheet = game.user.isGM ? !!html.find('#social-screamsheet-toggle').is(':checked') : false;
                    const defaultName = (game.user.getFlag("VirtualAgent", "idOverrides")?.handle) || game.user.name;
                    const entry = {
                        id: "feed_" + foundry.utils.randomID(),
                        category, text,
                        authorId: game.user.id,
                        authorName: personaAs || defaultName,
                        isGmPersona: !!personaAs,
                        isScreamsheet,
                        timestamp: Date.now()
                    };
                    if (game.user.isGM) {
                        // GM writes directly
                        const raw = game.settings.get("VirtualAgent", "socialFeedArticles");
                        let list = [];
                        try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
                        list.push(entry);
                        await game.settings.set("VirtualAgent", "socialFeedArticles", JSON.stringify(list));
                        ui.notifications.info("Virtual Agent: Post published.");
                    } else {
                        // Players route through GM
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) {
                            ui.notifications.error("Virtual Agent: No System Admin online to publish your post.");
                            return;
                        }
                        game.socket.emit("module.VirtualAgent", { action: "socialFeedAppend", entry });
                        ui.notifications.info("Virtual Agent: Post transmitted.");
                    }
                    html.find('#social-post-text').val("");
                    html.find('#social-post-as').val("");
                    // Clear preserved drafts so the next re-render doesn't refill them.
                    if (this._composerDrafts) {
                        this._composerDrafts['social-post-text'] = "";
                        this._composerDrafts['social-post-as'] = "";
                    }
                    this.render(true);
                    break;
                }

                case 'delete-social-post': {
                    const postId = $(ev.currentTarget).data('post-id');
                    if (!postId) return;
                    const raw = game.settings.get("VirtualAgent", "socialFeedArticles");
                    let list = [];
                    try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
                    const entry = list.find(e => e.id === postId);
                    if (!entry) { return; }
                    const canDel = game.user.isGM || (entry.authorId === game.user.id);
                    if (!canDel) { ui.notifications.warn("Virtual Agent: You can only delete your own posts."); return; }
                    if (game.user.isGM) {
                        const next = list.filter(e => e.id !== postId);
                        await game.settings.set("VirtualAgent", "socialFeedArticles", JSON.stringify(next));
                        // setting onChange will trigger a render
                    } else {
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) { ui.notifications.error("Virtual Agent: No System Admin online to remove this post."); return; }
                        console.log("[Virtual Agent] Emitting socialFeedDelete:", { postId, requesterId: game.user.id });
                        game.socket.emit("module.VirtualAgent", { action: "socialFeedDelete", postId, requesterId: game.user.id });
                        // Don't local-render: wait for the GM's setting change to broadcast a fresh value.
                    }
                    break;
                }

                case 'save-social-feed': {
                    if (!game.user.isGM) return;
                    const raw = html.find('#admin-social-feed-input').val() || "";
                    let parsed = [];
                    // Accept JSON array OR "Category | Text" lines
                    const trimmed = raw.trim();
                    if (trimmed.startsWith("[")) {
                        try {
                            const j = JSON.parse(trimmed);
                            if (Array.isArray(j)) parsed = j.filter(e => e && (e.category || e.text));
                        } catch (e) {
                            ui.notifications.error("Virtual Agent: Invalid JSON in feed.");
                            return;
                        }
                    } else {
                        parsed = raw.split(/\r?\n/)
                            .map(line => line.trim())
                            .filter(Boolean)
                            .map(line => {
                                const idx = line.indexOf("|");
                                if (idx < 0) return { category: "Feed", text: line };
                                return { category: line.slice(0, idx).trim() || "Feed", text: line.slice(idx + 1).trim() };
                            })
                            .filter(e => e.text);
                    }
                    await game.settings.set("VirtualAgent", "socialFeedArticles", JSON.stringify(parsed));
                    ui.notifications.info(`Virtual Agent: NetStatus feed saved (${parsed.length} article${parsed.length === 1 ? "" : "s"}).`);
                    this.render(true);
                    break;
                }

                case 'reset-social-feed': {
                    if (!game.user.isGM) return;
                    await game.settings.set("VirtualAgent", "socialFeedArticles", "");
                    ui.notifications.info("Virtual Agent: NetStatus feed reset to defaults.");
                    this.render(true);
                    break;
                }

                case 'save-map-path': {
                    if (!game.user.isGM) return;
                    const val = (html.find('#admin-map-path-input').val() || "").trim() || "modules/VirtualAgent/assets/night-city-map-red-final-v2.png";
                    // Patch5.5.20: catch absolute filesystem paths (Windows C:/...,
                    // macOS/Linux /Users/... or /home/...) before they get saved to a
                    // setting that won't load. Image src needs a Foundry-relative
                    // path (worlds/, modules/, systems/, etc.). Warn but still save
                    // — the GM might be intentionally testing something.
                    if (/^[a-zA-Z]:[\\/]/.test(val) || /^\/(?:Users|home|Volumes)\//.test(val)) {
                        ui.notifications.warn("Map path looks like an absolute filesystem path. Foundry needs a path relative to the user-data root (e.g. 'worlds/MyWorld/maps/img.png'). Use the BROWSE button to pick the image correctly.");
                    }
                    await game.settings.set("VirtualAgent", "mapImagePath", val);
                    ui.notifications.info("Virtual Agent: Sat Map path saved.");
                    this.render(true);
                    break;
                }

                case 'reset-map-path': {
                    if (!game.user.isGM) return;
                    await game.settings.set("VirtualAgent", "mapImagePath", "modules/VirtualAgent/assets/night-city-map-red-final-v2.png");
                    ui.notifications.info("Virtual Agent: Sat Map reset to default.");
                    this.render(true);
                    break;
                }

                case 'save-ingame-clock': {
                    if (!game.user.isGM) return;
                    const clockVal = (html.find('#admin-clock-input').val() || "").trim();
                    // Validate HH:MM format
                    if (clockVal && !/^\d{1,2}:\d{2}$/.test(clockVal)) {
                        ui.notifications.warn("Virtual Agent: Invalid time format. Use HH:MM (e.g. 21:30)");
                        return;
                    }
                    await game.settings.set("VirtualAgent", "inGameClock", clockVal);
                    ui.notifications.info(clockVal ? `Virtual Agent: In-game clock set to ${clockVal}` : "Virtual Agent: Clock cleared — using real time.");
                    this.render(true);
                    break;
                }

                case 'clear-ingame-clock': {
                    if (!game.user.isGM) return;
                    await game.settings.set("VirtualAgent", "inGameClock", "");
                    ui.notifications.info("Virtual Agent: In-game clock cleared. Showing real time.");
                    this.render(true);
                    break;
                }

                case 'save-custom-store': {
                    if (!game.user.isGM) return;
                    const rawJson = (html.find('#admin-custom-store-input').val() || "[]").trim();
                    // Validate JSON
                    try {
                        const parsed = JSON.parse(rawJson);
                        if (!Array.isArray(parsed)) throw new Error("Must be a JSON array");
                        for (const it of parsed) {
                            if (!it.name || !it.category || !it.price) {
                                throw new Error(`Item missing required fields (name, category, price): ${JSON.stringify(it)}`);
                            }
                        }
                        await game.settings.set("VirtualAgent", "customStoreItems", rawJson);
                        this._storeCatalog = null; this._storeLoading = null; // invalidate cache
                        ui.notifications.info(`Virtual Agent: ${parsed.length} custom store item(s) saved.`);
                    } catch (e) {
                        ui.notifications.error(`Virtual Agent: Invalid JSON — ${e.message}`);
                        return;
                    }
                    this.render(true);
                    break;
                }

                case 'add-custom-store-template': {
                    if (!game.user.isGM) return;
                    const textarea = html.find('#admin-custom-store-input');
                    let existing = [];
                    try { existing = JSON.parse(textarea.val() || "[]"); } catch (e) { existing = []; }
                    existing.push({ name: "New Item", category: "Gear", price: 100, description: "" });
                    textarea.val(JSON.stringify(existing, null, 2));
                    break;
                }

                case 'add-custom-store-item': {
                    // Patch4.7 follow-up: form-based custom item builder. Reads
                    // the field inputs, validates, appends to the existing
                    // customStoreItems setting, busts the catalog cache. No
                    // JSON typing required.
                    if (!game.user.isGM) return;
                    const name = (html.find('#custom-item-name').val() || "").trim();
                    const category = (html.find('#custom-item-category').val() || "").trim();
                    const priceRaw = html.find('#custom-item-price').val();
                    const price = Number(priceRaw);
                    const description = (html.find('#custom-item-description').val() || "").trim();
                    const img = (html.find('#custom-item-img').val() || "").trim();
                    if (!name) { ui.notifications.warn("Virtual Agent: Item name required."); return; }
                    if (!category) { ui.notifications.warn("Virtual Agent: Category required."); return; }
                    if (!Number.isFinite(price) || price <= 0) { ui.notifications.warn("Virtual Agent: Price must be a positive number."); return; }
                    let existing = [];
                    try { existing = JSON.parse(game.settings.get("VirtualAgent", "customStoreItems") || "[]"); } catch(e) { existing = []; }
                    if (!Array.isArray(existing)) existing = [];
                    const newItem = { name, category, price };
                    if (description) newItem.description = description;
                    if (img) newItem.img = img;
                    existing.push(newItem);
                    await game.settings.set("VirtualAgent", "customStoreItems", JSON.stringify(existing));
                    this._storeCatalog = null; this._storeLoading = null;
                    // Clear the form fields + their preserved drafts
                    ["custom-item-name","custom-item-category","custom-item-price","custom-item-description","custom-item-img"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Virtual Agent: Added "${name}" (${category}, ${price}eb) to NuNu Mart.`);
                    this.render(true);
                    break;
                }

                case 'copy-pack-id': {
                    // Patch4.7 follow-up: append the picked pack ID to the
                    // custom packs list (avoids the user having to remember /
                    // type the exact namespace). Saves immediately.
                    if (!game.user.isGM) return;
                    const packId = String($(ev.currentTarget).data('pack-id') || "");
                    if (!packId) return;
                    const cur = String(game.settings.get("VirtualAgent", "customStorePacks") || "");
                    const entries = cur.split(",").map(s => s.trim()).filter(Boolean);
                    if (entries.includes(packId)) {
                        ui.notifications.info(`Virtual Agent: ${packId} already in the custom packs list.`);
                        return;
                    }
                    entries.push(packId);
                    const next = entries.join(", ");
                    await game.settings.set("VirtualAgent", "customStorePacks", next);
                    this._storeCatalog = null; this._storeLoading = null;
                    ui.notifications.info(`Virtual Agent: Added ${packId} — items will load on next NuNu Mart open.`);
                    this.render(true);
                    break;
                }

                case 'save-store-gates': {
                    // Patch4 round 6 (CommanderCrunch69): Max Price / Source
                    // Filter / Locked Categories inputs had no save action —
                    // edits never wrote back. This commits all three to their
                    // world settings and busts the catalog cache so the shop
                    // re-renders with the new gates.
                    if (!game.user.isGM) return;
                    const rawPrice = html.find('#store-max-price-input').val();
                    const maxPrice = Math.max(0, Number(rawPrice) || 0);
                    const sourceFilter = html.find('#store-source-filter-select').val() || "all";
                    const locked = (html.find('#store-locked-categories-input').val() || "").trim();
                    await game.settings.set("VirtualAgent", "storeMaxPrice", maxPrice);
                    await game.settings.set("VirtualAgent", "storeSourceFilter", sourceFilter);
                    await game.settings.set("VirtualAgent", "storeLockedCategories", locked);
                    this._storeCatalog = null; this._storeLoading = null;
                    const summary = [];
                    summary.push(maxPrice > 0 ? `cap ${maxPrice}eb` : "no cap");
                    summary.push(`source=${sourceFilter}`);
                    if (locked) summary.push(`locked: ${locked}`);
                    ui.notifications.info(`Virtual Agent: NuNu Mart gates saved — ${summary.join(", ")}.`);
                    this.render(true);
                    break;
                }

                case 'reset-store-gates': {
                    if (!game.user.isGM) return;
                    await game.settings.set("VirtualAgent", "storeMaxPrice", 0);
                    await game.settings.set("VirtualAgent", "storeSourceFilter", "all");
                    await game.settings.set("VirtualAgent", "storeLockedCategories", "");
                    this._storeCatalog = null; this._storeLoading = null;
                    ui.notifications.info("Virtual Agent: NuNu Mart gates cleared (no cap, all sources, no locked categories).");
                    this.render(true);
                    break;
                }

                case 'store-blacklist-add': {
                    if (!game.user.isGM) return;
                    const val = (html.find('#store-blacklist-input').val() || "").trim();
                    if (!val) return;
                    const cur = String(game.settings.get("VirtualAgent", "storeBlacklistIds") || "");
                    const entries = cur.split(/[,\n]/).map(s => s.trim()).filter(Boolean);
                    if (!entries.includes(val)) entries.push(val);
                    await game.settings.set("VirtualAgent", "storeBlacklistIds", entries.join(", "));
                    html.find('#store-blacklist-input').val("");
                    this._storeCatalog = null; this._storeLoading = null;
                    this.render(true);
                    break;
                }

                case 'store-blacklist-remove': {
                    if (!game.user.isGM) return;
                    const entry = $(ev.currentTarget).data('entry');
                    if (!entry) return;
                    const cur = String(game.settings.get("VirtualAgent", "storeBlacklistIds") || "");
                    const entries = cur.split(/[,\n]/).map(s => s.trim()).filter(Boolean).filter(e => e !== String(entry));
                    await game.settings.set("VirtualAgent", "storeBlacklistIds", entries.join(", "));
                    this._storeCatalog = null; this._storeLoading = null;
                    this.render(true);
                    break;
                }

                case 'remove-custom-store-item': {
                    // Patch3 (CommanderCrunch69): one-click removal from the parsed list.
                    if (!game.user.isGM) return;
                    const idx = Number($(ev.currentTarget).data('item-index'));
                    if (!Number.isFinite(idx)) return;
                    let raw = game.settings.get("VirtualAgent", "customStoreItems") || "[]";
                    let list = [];
                    try { list = JSON.parse(raw); } catch (e) { list = []; }
                    if (!Array.isArray(list) || idx < 0 || idx >= list.length) return;
                    const removed = list[idx];
                    list.splice(idx, 1);
                    await game.settings.set("VirtualAgent", "customStoreItems", JSON.stringify(list));
                    this._storeCatalog = null; this._storeLoading = null;
                    ui.notifications.info(`Virtual Agent: Removed "${removed?.name || 'item'}" from NuNu Mart.`);
                    this.render(true);
                    break;
                }

                case 'save-custom-packs': {
                    if (!game.user.isGM) return;
                    const packsVal = (html.find('#admin-custom-packs-input').val() || "").trim();
                    await game.settings.set("VirtualAgent", "customStorePacks", packsVal);
                    this._storeCatalog = null; this._storeLoading = null; // invalidate cache
                    ui.notifications.info("Virtual Agent: Custom compendium packs saved.");
                    this.render(true);
                    break;
                }

                case 'toggle-ui-skin': {
                    if (!game.user.isGM) return;
                    const cur = game.settings.get("VirtualAgent", "uiSkin") || "red";
                    const next = cur === "red" ? "2077" : "red";
                    await game.settings.set("VirtualAgent", "uiSkin", next);
                    ui.notifications.info(`Virtual Agent: UI skin set to ${next.toUpperCase()}`);
                    // onChange in main.js broadcasts refreshSkin to clients
                    this.render(true);
                    break;
                }

                case 'save-tt-coverage': {
                    // Patch4.7 (Gotto): GM writes TT coverage tier + Fixer rank
                    // to each player's user flag.
                    if (!game.user.isGM) return;
                    for (const u of game.users.filter(x => !x.isGM)) {
                        const val = (html.find(`#tt-coverage-${u.id}`).val() || "").trim();
                        const prev = u.getFlag("VirtualAgent", "ttCoverage") || "";
                        if (val !== prev) await u.setFlag("VirtualAgent", "ttCoverage", val);
                        const rankRaw = html.find(`#fixer-rank-${u.id}`).val();
                        const rank = parseInt(rankRaw, 10);
                        const rankSafe = isNaN(rank) ? 0 : Math.max(0, Math.min(10, rank));
                        const rankPrev = Number(u.getFlag("VirtualAgent", "fixerRank")) || 0;
                        if (rankSafe !== rankPrev) await u.setFlag("VirtualAgent", "fixerRank", rankSafe);
                    }
                    ui.notifications.info("Agent Bio: TT coverage + Fixer rank updated.");
                    this.render(true);
                    break;
                }

                case 'admin-wallet-select': {
                    // Patch4.7 (Gotto): GM picks which wallet identity Sys Admin
                    // is acting against. Writes to `selectedAdminActorUuid` only —
                    // does NOT affect app-lock tabs (those use `_appLockPlayerUuid`).
                    if (!game.user.isGM) return;
                    const newTarget = $(ev.currentTarget).data('target-uuid');
                    if (!newTarget) break;
                    const _adminConsole = this.element.find('.admin-console')[0];
                    const _savedAdminScroll = _adminConsole ? _adminConsole.scrollTop : 0;
                    this.selectedAdminActorUuid = newTarget;

                    // 5.5.21: Wallet Identity tab now also drives the Agent ID
                    // view target. When GM picks a PC tab, the Agent ID card
                    // swaps to that PC's owner-user too — so wallet + ID stay
                    // in sync without the GM having to pick the same player
                    // twice. VirtualWallet leaves _idViewTargetUserId alone
                    // (GM may have it parked on a specific player already).
                    // DISPLAY-ONLY SYNC — message authoring, social posts,
                    // and auction bids still use real game.user identity.
                    if (newTarget && newTarget !== "VirtualWallet") {
                        const targetActor = this._resolveActor(newTarget);
                        if (targetActor) {
                            const ownerUser = game.users.find(u => !u.isGM && targetActor.testUserPermission(u, "OWNER"));
                            if (ownerUser) this._idViewTargetUserId = ownerUser.id;
                        }
                    }

                    this.render(true);
                    if (_savedAdminScroll > 0) {
                        const _restoreAdminScroll = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el) el.scrollTop = _savedAdminScroll;
                        };
                        requestAnimationFrame(_restoreAdminScroll);
                        setTimeout(_restoreAdminScroll, 0);
                        setTimeout(_restoreAdminScroll, 50);
                        setTimeout(_restoreAdminScroll, 150);
                    }
                    break;
                }

                case 'admin-tab-select': {
                    // Patch4 round 2: tabs now scope ONLY the Application
                    // Access toggles. GM identity / wallet view / transfers
                    // are unchanged. Writes to `_appLockPlayerUuid` only.
                    if (!game.user.isGM) return;
                    const newTarget = $(ev.currentTarget).data('target-uuid');
                    if (!newTarget) break;
                    // Patch4 round 4 (snap-to-top fix v2): the generic scroll
                    // preserver wasn't enough — capture and restore directly
                    // on this specific action, since tab clicks are the most
                    // common trigger for the bug. Save the admin-console
                    // scroll position synchronously here, render, then push
                    // the restore through multiple frames to defeat whatever
                    // is resetting it (likely the focus-management pass).
                    const _adminConsole = this.element.find('.admin-console')[0];
                    const _savedAdminScroll = _adminConsole ? _adminConsole.scrollTop : 0;
                    this._appLockPlayerUuid = newTarget;
                    this.render(true);
                    if (_savedAdminScroll > 0) {
                        const _restoreAdminScroll = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el) el.scrollTop = _savedAdminScroll;
                        };
                        // Stack multiple restore attempts at different times so
                        // we catch the final post-layout state regardless of
                        // when Foundry stops messing with scroll.
                        requestAnimationFrame(_restoreAdminScroll);
                        setTimeout(_restoreAdminScroll, 0);
                        setTimeout(_restoreAdminScroll, 50);
                        setTimeout(_restoreAdminScroll, 150);
                    }
                    break;
                }

                case 'toggle-app-lock': {
                    if (!game.user.isGM) return;
                    const appId = $(ev.currentTarget).data('app-id');
                    // Patch4 round 2: app-lock toggles are now driven by the
                    // dedicated `_appLockPlayerUuid` tab state. "VirtualWallet"
                    // means GM's own flags. "User.<id>" means a player with
                    // no assigned character (write to the user flag). Anything
                    // else is an actor uuid (write to the actor's flag).
                    const lockTargetUuid = this._appLockPlayerUuid || "VirtualWallet";
                    if (lockTargetUuid === "Everyone") {
                        // NuNu packaging: the GM's own list decides the direction; every phone gets the same result.
                        const FALLBACK = ['chat', 'data', 'creds', 'map', 'id', 'social', 'bio', 'store', 'style', 'rep', 'auction', 'ncpd', 'ziggurat', 'garden', 'combat', 'skills'];
                        const owners = this._everyoneOwners();
                        // Direction: if every player already has the app, switch it off for all; otherwise switch it on for all.
                        const turnOn = !owners.every((o) => (o.getFlag("VirtualAgent", "unlockedApps") || FALLBACK).includes(appId));
                        const _adminConsoleA = this.element.find('.admin-console')[0];
                        const _savedAdminScrollA = _adminConsoleA ? _adminConsoleA.scrollTop : 0;
                        for (const o of owners) {
                            let list = o.getFlag("VirtualAgent", "unlockedApps") || FALLBACK;
                            list = turnOn ? (list.includes(appId) ? list : [...list, appId]) : list.filter(a => a !== appId);
                            await o.setFlag("VirtualAgent", "unlockedApps", list);
                            await o.setFlag("VirtualAgent", "unlockedAppsMigrated5_6", true);
                        }
                        game.socket.emit("module.VirtualAgent", { action: "refreshApps" });
                        this.render(true);
                        if (_savedAdminScrollA > 0) {
                            const _restoreA = () => { const el = this.element?.find?.('.admin-console')?.[0]; if (el) el.scrollTop = _savedAdminScrollA; };
                            requestAnimationFrame(_restoreA); setTimeout(_restoreA, 0); setTimeout(_restoreA, 50); setTimeout(_restoreA, 150);
                        }
                        break;
                    }
                    let targetObj = null;
                    if (lockTargetUuid === "VirtualWallet") {
                        targetObj = game.user; // GM
                    } else if (lockTargetUuid.startsWith("User.")) {
                        targetObj = game.users.get(lockTargetUuid.split(".")[1]);
                    } else {
                        targetObj = fromUuidSync(lockTargetUuid);
                    }
                    if (!targetObj) return;

                    // Patch4 round 5 (scroll-snap fix): same pattern as the
                    // admin-tab-select handler — snapshot the admin-console
                    // scroll BEFORE the render, restore via stacked timers.
                    const _adminConsoleT = this.element.find('.admin-console')[0];
                    const _savedAdminScrollT = _adminConsoleT ? _adminConsoleT.scrollTop : 0;

                    // Patch5.5.2: fallback list must match `defaultApps` above
                    // (5.5 added ncpd / ziggurat / garden). Out-of-sync fallback
                    // here would reset a player's unlockedApps to the old 11-app
                    // list on first toggle, effectively re-hiding the new apps.
                    let unlocked = targetObj.getFlag("VirtualAgent", "unlockedApps") || ['chat', 'data', 'creds', 'map', 'id', 'social', 'bio', 'store', 'style', 'rep', 'auction', 'ncpd', 'ziggurat', 'garden', 'combat', 'skills'];
                    unlocked = unlocked.includes(appId) ? unlocked.filter(a => a !== appId) : [...unlocked, appId];
                    await targetObj.setFlag("VirtualAgent", "unlockedApps", unlocked);
                    game.socket.emit("module.VirtualAgent", { action: "refreshApps", actorUuid: lockTargetUuid });
                    this.render(true);

                    if (_savedAdminScrollT > 0) {
                        const _restoreAdminScrollT = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el) el.scrollTop = _savedAdminScrollT;
                        };
                        requestAnimationFrame(_restoreAdminScrollT);
                        setTimeout(_restoreAdminScrollT, 0);
                        setTimeout(_restoreAdminScrollT, 50);
                        setTimeout(_restoreAdminScrollT, 150);
                    }
                    break;
                }

                case 'pay-all-players': {
                    // Patch4.5: open in-phone modal instead of Foundry Dialog
                    // (consistent with Edit Agent ID / Ledger modals).
                    if (!game.user.isGM) return;
                    this.showPayAllModal = true;
                    this.render(true);
                    break;
                }

                case 'cancel-pay-all': {
                    this.showPayAllModal = false;
                    this.render(true);
                    break;
                }

                case 'confirm-pay-all': {
                    if (!game.user.isGM) return;
                    const amount = parseInt(html.find('#pay-all-amount').val());
                    const memo   = (html.find('#pay-all-memo').val() || "").trim() || "Gig Payout";
                    if (isNaN(amount) || amount <= 0) {
                        ui.notifications.warn("Agent Bank: Enter a positive amount.");
                        return;
                    }
                    this.showPayAllModal = false;
                    const fromUuid = this._getIdentity(game.user);
                    let paidCount = 0;
                    for (const player of this._getPartyPlayers()) {
                        if (!player.actorUuid) continue;
                        const ok = await this._executeTransfer(fromUuid, player.actorUuid, amount, memo);
                        if (ok) paidCount++;
                    }
                    ui.notifications.info(`Agent Bank: Paid ${amount}eb to ${paidCount} player(s). Memo: ${memo}`);
                    this.render(true);
                    break;
                }

                case 'add-manual-tx':
                    if (!game.user.isGM) return ui.notifications.warn("Agent: Ledger entries restricted to System Admin.");
                    this.showLedgerModal = true; this.render(true);
                    break;

                case 'cancel-ledger':
                    this.showLedgerModal = false; this.render(true);
                    break;

                case 'confirm-ledger': {
                    if (!game.user.isGM) return;
                    const lAmount = parseInt(html.find('#ledger-amount').val());
                    const lMemo = html.find('#ledger-memo').val() || "Manual Entry";
                    if (isNaN(lAmount) || lAmount === 0) {
                        ui.notifications.warn("Agent Bank: Enter a non-zero amount.");
                        return;
                    }
                    this.showLedgerModal = false;
                    if (lAmount > 0) {
                        await this._executeTransfer("VirtualWallet", this.actorUuid, lAmount, lMemo);
                    } else {
                        // Negative = deduction from target account
                        await this._executeTransfer(this.actorUuid, "VirtualWallet", Math.abs(lAmount), `[DEBIT] ${lMemo}`);
                    }
                    this.render(true);
                    break;
                }

                case 'map-zoom-in': {
                    this.mapZoom = Math.min((this.mapZoom || 1) * 1.2, 4);
                    this.render(true);
                    break;
                }

                case 'map-zoom-out': {
                    this.mapZoom = Math.max((this.mapZoom || 1) / 1.2, 0.4);
                    this.render(true);
                    break;
                }

                case 'refresh-creds': {
                    // Force-resolve the live actor, re-read flags from the DB,
                    // and re-render the wallet. Works in V12 where local caches
                    // can lag behind remote setFlag() writes from other clients.
                    this.actorUuid = this._getIdentity(game.user);
                    const liveActor = this._resolveActor(this.actorUuid);
                    if (liveActor) {
                        // Touch the actor to force a fresh read from the world DB.
                        try { liveActor.reset?.(); } catch (e) { /* non-fatal */ }
                    }
                    ui.notifications.info("Agent Bank: Ledger synced.");
                    this.render(true);
                    break;
                }

                case 'confirm-shard': {
                    if (!game.user.isGM) return;
                    const sTitle = html.find('#shard-title-input').val() || "ENCRYPTED_SHARD";
                    const sBody = html.find('#shard-content-input').val() || "SYSTEM_EMPTY";
                    const sTarget = html.find('#shard-target-selector').val();
                    this.showShardModal = false;
                    await this._pushShard(sTarget, sTitle, sBody);
                    this.render(true);
                    break;
                }

                case 'delete-shard': {
                    if (!game.user.isGM) return;
                    const delId = $(ev.currentTarget).data('shard-id');
                    const delOwnerId = $(ev.currentTarget).data('shard-owner');
                    await this._deleteShard(delId, delOwnerId);
                    this.render(true);
                    break;
                }

                case 'back-to-datapool':
                    this.currentView = 'data'; this.activeShardId = null; this.render(true);
                    break;

                case 'toggle-store-affordable': {
                    this._storeFilterAffordable = !this._storeFilterAffordable;
                    this.render(true);
                    break;
                }

                case 'social-set-filter': {
                    // Patch4.7 (Gotto): click a category chip in the Social
                    // feed header to filter to just that category.
                    const cat = $(ev.currentTarget).data('cat');
                    this._socialFilter = cat ? String(cat) : "all";
                    this.render(true);
                    break;
                }

                case 'store-set-category': {
                    // Save current scroll position before switching
                    const oldCat = this._storeCategory;
                    const storeList = html.find('.store-item-list')[0];
                    if (storeList && oldCat) this._storeScrollPositions[oldCat] = storeList.scrollTop;
                    this._storeCategory = $(ev.currentTarget).data('category') || "All";
                    this._storeSearch = "";
                    this._storeView = 'list';
                    this._storeMode = 'catalog';
                    this.render(true);
                    break;
                }

                case 'store-set-mode': {
                    // Patch5.5: flip between regular catalog and the GM-curated Night Market.
                    const mode = String($(ev.currentTarget).data('mode') || "catalog");
                    this._storeMode = (mode === "nightmarket") ? "nightmarket" : "catalog";
                    this._storeSearch = "";
                    this._storeView = 'list';
                    this.render(true);
                    break;
                }

                case 'store-view-cart': {
                    this._storeView = 'cart';
                    this.render(true);
                    break;
                }

                case 'store-back-to-list': {
                    this._storeView = 'list';
                    this.render(true);
                    break;
                }

                case 'store-add-to-cart': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    if (!uuid || !this._storeCatalog) return;
                    let found = null;
                    for (const cat of Object.keys(this._storeCatalog)) {
                        const m = this._storeCatalog[cat].find(i => i.uuid === uuid);
                        if (m) { found = m; break; }
                    }
                    if (!found) return;
                    await this._addToCart(uuid, found);
                    ui.notifications.info(`NUNU MART: ${found.name} added to cart.`);
                    this.render(false);
                    break;
                }

                case 'store-qty-inc': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    const cur = (this._getCart().find(e => e.itemUuid === uuid)?.qty) || 0;
                    await this._setCartQty(uuid, cur + 1);
                    this.render(true);
                    break;
                }

                case 'store-qty-dec': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    const cur = (this._getCart().find(e => e.itemUuid === uuid)?.qty) || 0;
                    await this._setCartQty(uuid, cur - 1);
                    this.render(true);
                    break;
                }

                case 'store-remove-item': {
                    const uuid = $(ev.currentTarget).data('item-uuid');
                    await this._setCartQty(uuid, 0);
                    this.render(true);
                    break;
                }

                case 'store-checkout': {
                    await this._checkout();
                    break;
                }

                // --- STYLE CHECKER ---
                case 'style-tab': {
                    this._styleTab = $(ev.currentTarget).data('tab') || "outfit";
                    this.render(true);
                    break;
                }

                case 'toggle-style-info': {
                    // Patch3 (CommanderCrunch69 question): surface the Style formula.
                    this._showStyleInfo = !this._showStyleInfo;
                    this.render(false);
                    break;
                }

                // --- REPUTATION TRACKER ---
                case 'rep-set-standing': {
                    // NuNu packaging: standing is stored against the contact id, world-scope.
                    if (!game.user.isGM) { ui.notifications.warn("Agent: Only the GM sets standing."); break; }
                    const id = String($(ev.currentTarget).data('npc-id') || "");
                    const standing = String($(ev.currentTarget).data('standing') || "neutral");
                    if (!id) break;
                    let cur = {};
                    try { const raw = game.settings.get("VirtualAgent", "contactMeta"); cur = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {}); } catch (e) { cur = {}; }
                    cur[id] = { ...(cur[id] || {}), standing };
                    await game.settings.set("VirtualAgent", "contactMeta", JSON.stringify(cur));
                    this.render(true);
                    break;
                }

                // NuNu packaging: 'rep-add-npc' removed. Contacts are created and purged in the Messenger,
                // which is the one list. This view only labels them.

                // NuNu packaging: 'rep-delete-npc' removed. Contacts are created and purged in the Messenger,
                // which is the one list. This view only labels them.

                // ════════════════════════════════════════════════════════════
                // Patch5.5 — Black Chrome / All About Agents app actions
                // ════════════════════════════════════════════════════════════

                // --- NCPD CRIME DATABASE ---
                case 'ncpd-modal-open': {
                    if (!game.user.isGM) return;
                    this.showNcpdAddModal = true; this.render(true); break;
                }
                case 'ncpd-modal-close': {
                    this.showNcpdAddModal = false; this.render(true); break;
                }
                case 'ziggurat-modal-open': {
                    if (!game.user.isGM) return;
                    this.showZigguratAddModal = true; this.render(true); break;
                }
                case 'ziggurat-modal-close': {
                    this.showZigguratAddModal = false; this.render(true); break;
                }
                case 'garden-modal-open': {
                    this._gardenPendingPhoto = null;   // 1.8.0 — don't carry a stale attachment into a new add
                    this.showGardenAddModal = true; this.render(true); break;   // 1.6.0 — players too
                }
                case 'garden-modal-close': {
                    this._gardenPendingPhoto = null;
                    this.showGardenAddModal = false; this.render(true); break;
                }
                case 'ncpd-search': {
                    this._ncpdSearch = String($(ev.currentTarget).val() || "");
                    this.render(false);
                    break;
                }
                case 'ncpd-open-record': {
                    this._ncpdActiveId = String($(ev.currentTarget).data('record-id') || "");
                    this.render(true);
                    break;
                }
                case 'ncpd-close-record': {
                    this._ncpdActiveId = null;
                    this.render(true);
                    break;
                }
                case 'ncpd-add-record': {
                    if (!game.user.isGM) return;
                    // Patch5.5.5: prefer the modal-prefixed inputs when the modal is open
                    const useModal = this.showNcpdAddModal && html.find('#ncpd-modal-name').length > 0;
                    const name = useModal
                        ? (html.find('#ncpd-modal-name').val() || "").trim()
                        : (html.find('#ncpd-add-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Bounties: a name is required."); return; }
                    const charges = useModal ? (html.find('#ncpd-modal-charges').val() || "").trim() : (html.find('#ncpd-add-charges').val() || "").trim();
                    const bounty  = useModal ? (html.find('#ncpd-modal-bounty').val()  || "").trim() : (html.find('#ncpd-add-bounty').val()  || "").trim();
                    const status  = useModal ? (html.find('#ncpd-modal-status').val()  || "Known to police").trim() : (html.find('#ncpd-add-status').val() || "Known to police").trim();
                    const notes   = useModal ? (html.find('#ncpd-modal-notes').val()   || "").trim() : (html.find('#ncpd-add-notes').val()   || "").trim();
                    // Patch5.5.18: the const mugshot declaration was missing — list.push later
                    // referenced an undefined `mugshot` symbol → ReferenceError swallowed by
                    // Foundry's event-handler wrapper → FILE button appeared to hang.
                    const mugshot = useModal ? (html.find('#ncpd-modal-mugshot').val() || "").trim() : "";
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "ncpdRapSheets") || "[]"); } catch(e) {}
                    list.push({
                        id: "rap_" + foundry.utils.randomID(),
                        name, charges, bounty, status, notes, mugshot,
                        // NuNu packaging: a bounty knows who is paying it, and a debt claim
                        // pays the finder a tenth of the debt for bringing the debtor back alive.
                        kind: useModal ? (html.find('#ncpd-modal-kind').val() || "bounty") : (html.find('#ncpd-add-kind').val() || "bounty"),
                        source: (useModal ? (html.find('#ncpd-modal-source').val() || "") : (html.find('#ncpd-add-source').val() || "")).trim(),
                        debt: (useModal ? (html.find('#ncpd-modal-debt').val() || "") : (html.find('#ncpd-add-debt').val() || "")).trim(),
                        createdAt: Date.now()
                    });
                    await game.settings.set("VirtualAgent", "ncpdRapSheets", JSON.stringify(list));
                    if (useModal) this.showNcpdAddModal = false;
                    // Patch5.5.19: reset list-view state so the GM definitively
                    // lands on the unfiltered list with the new record visible.
                    // Previously, if a search was active or a detail view was
                    // open, the post-save render still respected those states
                    // and the new card appeared not to land. Now: clear search,
                    // close detail view, force list mode.
                    this._ncpdActiveId = null;
                    this._ncpdSearch = "";
                    ["ncpd-add-name","ncpd-add-charges","ncpd-add-bounty","ncpd-add-status","ncpd-add-notes",
                     "ncpd-modal-name","ncpd-modal-charges","ncpd-modal-bounty","ncpd-modal-status","ncpd-modal-notes","ncpd-modal-mugshot",
                     "ncpd-add-source","ncpd-add-debt","ncpd-modal-source","ncpd-modal-debt"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Bounties: filed "${name}".`);
                    this.render(true);
                    break;
                }
                case 'ncpd-delete-record': {
                    if (!game.user.isGM) return;
                    const rid = String($(ev.currentTarget).data('record-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "ncpdRapSheets") || "[]"); } catch(e) {}
                    list = list.filter(r => r.id !== rid);
                    await game.settings.set("VirtualAgent", "ncpdRapSheets", JSON.stringify(list));
                    this.render(true);
                    break;
                }

                // --- ZIGGURAT CITY DATABASE ---
                case 'ziggurat-search': {
                    this._zigguratSearch = String($(ev.currentTarget).val() || "");
                    this.render(false);
                    break;
                }
                case 'ziggurat-set-category': {
                    this._zigguratCategory = String($(ev.currentTarget).data('category') || "All");
                    this.render(true);
                    break;
                }
                case 'ziggurat-add-entry': {
                    if (!game.user.isGM) return;
                    const useZigModal = this.showZigguratAddModal && html.find('#ziggurat-modal-name').length > 0;
                    const name = useZigModal
                        ? (html.find('#ziggurat-modal-name').val() || "").trim()
                        : (html.find('#ziggurat-add-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Ziggurat: Entry name required."); return; }
                    const category = useZigModal ? (html.find('#ziggurat-modal-category').val() || "Other").trim() : (html.find('#ziggurat-add-category').val() || "Other").trim();
                    const address  = useZigModal ? (html.find('#ziggurat-modal-address').val()  || "").trim() : (html.find('#ziggurat-add-address').val()  || "").trim();
                    const hours    = useZigModal ? (html.find('#ziggurat-modal-hours').val()    || "").trim() : (html.find('#ziggurat-add-hours').val()    || "").trim();
                    const notes    = useZigModal ? (html.find('#ziggurat-modal-notes').val()    || "").trim() : (html.find('#ziggurat-add-notes').val()    || "").trim();
                    // Patch5.5.12: optional venue/fixer image. Renders next to name in detail + list views.
                    const image = useZigModal ? (html.find('#ziggurat-modal-image').val() || "").trim() : "";
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "cityDirectoryEntries") || "[]"); } catch(e) {}
                    list.push({
                        id: "city_" + foundry.utils.randomID(),
                        name, category, address, hours, notes, image
                    });
                    await game.settings.set("VirtualAgent", "cityDirectoryEntries", JSON.stringify(list));
                    if (useZigModal) this.showZigguratAddModal = false;
                    ["ziggurat-add-name","ziggurat-add-category","ziggurat-add-address","ziggurat-add-hours","ziggurat-add-notes","ziggurat-modal-image",
                     "ziggurat-modal-name","ziggurat-modal-category","ziggurat-modal-address","ziggurat-modal-hours","ziggurat-modal-notes"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Ziggurat: Added "${name}" to the city directory.`);
                    this.render(true);
                    break;
                }
                case 'ziggurat-delete-entry': {
                    if (!game.user.isGM) return;
                    const eid = String($(ev.currentTarget).data('entry-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "cityDirectoryEntries") || "[]"); } catch(e) {}
                    list = list.filter(r => r.id !== eid);
                    await game.settings.set("VirtualAgent", "cityDirectoryEntries", JSON.stringify(list));
                    this.render(true);
                    break;
                }

                // --- THE GARDEN ---
                case 'garden-open-profile': {
                    this._gardenActiveId = String($(ev.currentTarget).data('profile-id') || "");
                    this.render(true);
                    break;
                }
                case 'garden-close-profile': {
                    this._gardenActiveId = null;
                    this.render(true);
                    break;
                }
                case 'garden-message-profile': {
                    // Player taps "Message" on a profile → materialise an NPC
                    // contact + open a Messenger thread with them.
                    const pid = String($(ev.currentTarget).data('profile-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "gardenProfiles") || "[]"); } catch(e) {}
                    const profile = list.find(p => p.id === pid);
                    if (!profile) { ui.notifications.warn("The Garden: profile not found."); return; }
                    const contactId = `npc_garden_${pid}`;
                    let mine = game.user.getFlag("VirtualAgent", "customContacts") || [];
                    if (!mine.some(c => c.id === contactId)) {
                        mine = mine.concat([{
                            id: contactId,
                            name: profile.name || "Garden match",
                            originalName: profile.name || "Garden match",
                            avatar: profile.photo || "",
                            isPlayer: false,
                            targetUserIds: [game.user.id]
                        }]);
                        await game.user.setFlag("VirtualAgent", "customContacts", mine);
                    }
                    this.activeContactId = contactId;
                    this.currentView = 'chat-thread';
                    this._gardenActiveId = null;
                    this.render(true);
                    break;
                }
                case 'garden-add-profile': {
                    const useGarModal = this.showGardenAddModal && html.find('#garden-modal-name').length > 0;
                    const name = useGarModal
                        ? (html.find('#garden-modal-name').val() || "").trim()
                        : (html.find('#garden-add-name').val() || "").trim();
                    if (!name) { ui.notifications.warn("Garden: Name required."); return; }
                    const age          = useGarModal ? (html.find('#garden-modal-age').val()          || "").trim() : (html.find('#garden-add-age').val()          || "").trim();
                    const photo        = useGarModal ? (html.find('#garden-modal-photo').val()        || "").trim() : (html.find('#garden-add-photo').val()        || "").trim();
                    const bio          = useGarModal ? (html.find('#garden-modal-bio').val()          || "").trim() : (html.find('#garden-add-bio').val()          || "").trim();
                    const interests    = useGarModal ? (html.find('#garden-modal-interests').val()    || "").trim() : (html.find('#garden-add-interests').val()    || "").trim();
                    const availability = useGarModal ? (html.find('#garden-modal-availability').val() || "Active").trim() : (html.find('#garden-add-availability').val() || "Active").trim();
                    const profile = {
                        id: "g_" + foundry.utils.randomID(),
                        name, age, photo, bio, interests, availability,
                        targetUserIds: [],
                        addedBy: game.user.id   // 1.6.0 — track who posted (GM or a player)
                    };
                    if (game.user.isGM) {
                        // 1.8.0 — pending upload: store it in the dedicated garden folder first.
                        if (this._gardenPendingPhoto?.dataUrl) {
                            try {
                                const dir = await this._ensureGardenUploadDir();
                                const blob = await (await fetch(this._gardenPendingPhoto.dataUrl)).blob();
                                const ext = blob.type === "image/webp" ? "webp" : (blob.type === "image/jpeg" ? "jpg" : "png");
                                const f = new File([blob], `garden-${foundry.utils.randomID()}.${ext}`, { type: blob.type });
                                const up = await FilePicker.upload("data", dir, f, {}, { notify: false });
                                if (up?.path) profile.photo = up.path;
                            } catch (e) { console.warn("[VirtualAgent] garden photo upload failed:", e); ui.notifications.warn("The Garden: photo upload failed — profile posted without it."); }
                        }
                        let list = [];
                        try { list = JSON.parse(game.settings.get("VirtualAgent", "gardenProfiles") || "[]"); } catch(e) {}
                        list.push(profile);
                        await game.settings.set("VirtualAgent", "gardenProfiles", JSON.stringify(list));
                    } else {
                        // 1.6.0 — players can't write a world setting, so relay the profile to the GM
                        // (mirrors the social-feed post relay). The GM appends it + the setting onChange re-renders all.
                        const gmOnline = game.users.some(u => u.isGM && u.active);
                        if (!gmOnline) { ui.notifications.warn("The Garden: no System Admin online to post your profile."); return; }
                        // 1.8.0 — the player's uploaded image rides the payload; the GM stores it in
                        // the locked garden folder and fills in the path (players can't write files).
                        game.socket.emit("module.VirtualAgent", {
                            action: "gardenAddProfile", profile,
                            photoUpload: this._gardenPendingPhoto?.dataUrl || null
                        });
                    }
                    this._gardenPendingPhoto = null;
                    if (useGarModal) this.showGardenAddModal = false;
                    ["garden-add-name","garden-add-age","garden-add-photo","garden-add-bio","garden-add-interests","garden-add-availability",
                     "garden-modal-name","garden-modal-age","garden-modal-photo","garden-modal-bio","garden-modal-interests","garden-modal-availability"].forEach(id => {
                        html.find(`#${id}`).val("");
                        if (this._composerDrafts) this._composerDrafts[id] = "";
                    });
                    ui.notifications.info(`Garden: Added profile for "${name}".`);
                    this.render(true);
                    break;
                }
                case 'garden-delete-profile': {
                    if (!game.user.isGM) return;
                    const pid = String($(ev.currentTarget).data('profile-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "gardenProfiles") || "[]"); } catch(e) {}
                    list = list.filter(p => p.id !== pid);
                    await game.settings.set("VirtualAgent", "gardenProfiles", JSON.stringify(list));
                    this.render(true);
                    break;
                }

                // --- MAP INDICATORS ---
                case 'map-toggle-pin-mode': {
                    if (!game.user.isGM) return;
                    this._mapPinMode = !this._mapPinMode;
                    this.render(true);
                    break;
                }
                case 'map-pin-modal-cancel': {
                    this.showMapPinModal = false;
                    this.render(true);
                    break;
                }
                case 'map-pin-modal-save': {
                    if (!game.user.isGM) return;
                    const label = (html.find('#map-pin-modal-label').val() || "").trim();
                    if (!label) { ui.notifications.warn("Map: pin needs a label."); return; }
                    // Patch5.5.17: read selected radio by name (not by id — the swatches all
                    // shared the same id, which made jQuery #map-pin-modal-color match only
                    // the first entry and every pin came out blue regardless of click).
                    const color = (html.find('input[name="map-pin-modal-color"]:checked').val() || "#ffcc00").trim();
                    const icon = (html.find('input[name="map-pin-modal-icon"]:checked').val() || "fa-map-pin").trim();
                    const notes = (html.find('#map-pin-modal-notes').val() || "").trim();
                    const visible = !!html.find('#map-pin-modal-visible').is(':checked');
                    // Patch5.5.18 (Sleepingmann): per-pin label display mode.
                    // 'always' = label always visible (default), 'hover' = only on hover,
                    // 'off' = no label, just the icon.
                    const labelMode = String(html.find('input[name="map-pin-modal-label-mode"]:checked').val() || 'always');
                    let pins = [];
                    try { pins = JSON.parse(game.settings.get("VirtualAgent", "mapIndicators") || "[]"); } catch (e) {}
                    if (!Array.isArray(pins)) pins = [];
                    pins.push({
                        id: "pin_" + foundry.utils.randomID(),
                        label, color, icon, notes, labelMode,
                        x: Number(this._pendingPinX) || 50,
                        y: Number(this._pendingPinY) || 50,
                        isVisible: visible,
                        createdAt: Date.now()
                    });
                    await game.settings.set("VirtualAgent", "mapIndicators", JSON.stringify(pins));
                    this.showMapPinModal = false;
                    ui.notifications.info(`Map: Pin "${label}" placed.`);
                    this.render(true);
                    break;
                }
                case 'map-pin-manage-open': {
                    if (!game.user.isGM) return;
                    this.showMapPinManageModal = true;
                    this.render(true);
                    break;
                }
                case 'map-pin-manage-close': {
                    this.showMapPinManageModal = false;
                    this.render(true);
                    break;
                }
                case 'map-pin-toggle': {
                    if (!game.user.isGM) return;
                    const pid = String($(ev.currentTarget).data('pin-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "mapIndicators") || "[]"); } catch(e) {}
                    list = list.map(p => p.id === pid ? { ...p, isVisible: !p.isVisible } : p);
                    await game.settings.set("VirtualAgent", "mapIndicators", JSON.stringify(list));
                    this.render(true);
                    break;
                }
                case 'map-pin-delete': {
                    if (!game.user.isGM) return;
                    const pid = String($(ev.currentTarget).data('pin-id') || "");
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "mapIndicators") || "[]"); } catch(e) {}
                    list = list.filter(p => p.id !== pid);
                    await game.settings.set("VirtualAgent", "mapIndicators", JSON.stringify(list));
                    this.render(true);
                    break;
                }

                // --- HOUSING / RENT (per-user flag, set via Sys Admin) ---
                case 'save-housing': {
                    if (!game.user.isGM) return;
                    // Patch5.5.20: snap-back defense (rep-toggle pattern). setFlag fires
                    // onChange hooks that may trigger intermediate renders before the
                    // manual render(true) below. Pin the admin-console scroll for ~400ms
                    // via rAF so all intermediate renders converge on the saved value.
                    const _adminEl = this.element.find('.admin-console')[0];
                    const _pinScroll = _adminEl ? _adminEl.scrollTop : 0;
                    this._scrollPositions = this._scrollPositions || {};
                    if (_pinScroll > 0) this._scrollPositions['.admin-console'] = _pinScroll;
                    if (_pinScroll > 0) {
                        const startedAt = Date.now();
                        const reassert = () => {
                            const el = this.element?.find?.('.admin-console')?.[0];
                            if (el && el.scrollTop !== _pinScroll) el.scrollTop = _pinScroll;
                            if (Date.now() - startedAt < 400) requestAnimationFrame(reassert);
                        };
                        requestAnimationFrame(reassert);
                    }
                    const inputs = html.find('[data-housing-row]');
                    for (const el of inputs.toArray()) {
                        const $row = $(el);
                        const ownerKind = $row.data('owner-kind');
                        const ownerId = String($row.data('owner-id') || "");
                        if (!ownerId) continue;
                        const status = (html.find(`#housing-status-${ownerKind}-${ownerId}`).val() || "").trim();
                        const rent = (html.find(`#housing-rent-${ownerKind}-${ownerId}`).val() || "").trim();
                        const target = (ownerKind === 'actor') ? game.actors.get(ownerId) : game.users.get(ownerId);
                        if (!target) continue;
                        const prevS = target.getFlag("VirtualAgent", "housingStatus") || "";
                        const prevR = target.getFlag("VirtualAgent", "housingRent") || "";
                        if (status !== prevS) await target.setFlag("VirtualAgent", "housingStatus", status);
                        if (rent !== prevR) await target.setFlag("VirtualAgent", "housingRent", rent);
                        const life = (html.find(`#housing-life-${ownerKind}-${ownerId}`).val() || "").trim();
                        if (life !== (target.getFlag("VirtualAgent", "lifestyle") || "")) await target.setFlag("VirtualAgent", "lifestyle", life);
                    }
                    ui.notifications.info("Housing: roster updated.");
                    this.render(true);
                    break;
                }

                // --- NIGHT MARKET ---
                case 'nm-load-catalog': {
                    // Patch5.5.12: explicit Sys Admin trigger for loading the NC
                    // Mart catalog so the Night Market picker can populate without
                    // the GM having to open NuNu Mart first. Re-runs the same lazy
                    // loader the player-side NuNu Mart uses; cached on the instance.
                    if (!game.user.isGM) return;
                    if (this._storeCatalog) {
                        ui.notifications.info("NuNu Mart catalog: refreshing...");
                        this._storeCatalog = null;
                    } else {
                        ui.notifications.info("NuNu Mart catalog: importing (one moment)...");
                    }
                    try {
                        await this._loadStoreCatalog();
                        ui.notifications.info("NuNu Mart catalog: loaded.");
                    } catch (e) {
                        console.error(e);
                        ui.notifications.error("NuNu Mart catalog: load failed — see console.");
                    }
                    this.render(true);
                    break;
                }
                case 'nm-start': {
                    // Patch5.5.6: explicit START NIGHT MARKET — creates an empty
                    // market with a GM-chosen name. END clears it back to null.
                    if (!game.user.isGM) return;
                    const name = (html.find('#nm-start-name').val() || "Night Market").trim() || "Night Market";
                    const nm = { name, openedAt: Date.now(), items: [] };
                    await game.settings.set("VirtualAgent", "nightMarketActive", JSON.stringify(nm));
                    if (this._composerDrafts) this._composerDrafts['nm-start-name'] = "";
                    html.find('#nm-start-name').val("");
                    ui.notifications.info(`Night Market: "${name}" is now open. Add items to make it visible to players.`);
                    this.render(true);
                    break;
                }
                case 'nm-clear': {
                    if (!game.user.isGM) return;
                    await game.settings.set("VirtualAgent", "nightMarketActive", "");
                    ui.notifications.info("Night Market: cleared.");
                    this.render(true);
                    break;
                }
                case 'nm-add-from-catalog': {
                    if (!game.user.isGM) return;
                    const uuid = String($(ev.currentTarget).data('item-uuid') || "");
                    if (!uuid || !this._storeCatalog) return;
                    let found = null;
                    for (const cat of Object.keys(this._storeCatalog)) {
                        const m = this._storeCatalog[cat].find(i => i.uuid === uuid);
                        if (m) { found = m; break; }
                    }
                    if (!found) return;
                    const flavor = (html.find(`#nm-flavor-${uuid}`).val() || "").trim();
                    // Patch5.5.12: optional price override. Blank/0/non-numeric falls
                    // back to catalog price; any positive number wins. Lets the GM
                    // mark stuff up ("scarcity tax") or down ("fell off the truck").
                    const priceOverrideRaw = (html.find(`#nm-price-${uuid}`).val() || "").trim();
                    const priceOverride = Number(priceOverrideRaw);
                    const finalPrice = (priceOverrideRaw !== "" && Number.isFinite(priceOverride) && priceOverride >= 0)
                        ? priceOverride
                        : (Number(found.price) || 0);
                    let nm = null;
                    try { const raw = game.settings.get("VirtualAgent", "nightMarketActive") || ""; nm = raw ? JSON.parse(raw) : null; } catch(e) {}
                    if (!nm) nm = { name: "Night Market", openedAt: Date.now(), items: [] };
                    if (nm.items.some(it => it.uuid === uuid)) {
                        ui.notifications.warn("Night Market: item already in the curated list.");
                        return;
                    }
                    nm.items.push({
                        uuid: found.uuid,
                        name: found.name,
                        price: finalPrice,
                        catalogPrice: Number(found.price) || 0,
                        img: found.img || "",
                        flavor
                    });
                    await game.settings.set("VirtualAgent", "nightMarketActive", JSON.stringify(nm));
                    ui.notifications.info(`Night Market: Added "${found.name}".`);
                    this.render(true);
                    break;
                }
                case 'nm-remove-item': {
                    if (!game.user.isGM) return;
                    const uuid = String($(ev.currentTarget).data('item-uuid') || "");
                    let nm = null;
                    try { const raw = game.settings.get("VirtualAgent", "nightMarketActive") || ""; nm = raw ? JSON.parse(raw) : null; } catch(e) {}
                    if (!nm) return;
                    nm.items = (nm.items || []).filter(it => it.uuid !== uuid);
                    await game.settings.set("VirtualAgent", "nightMarketActive", JSON.stringify(nm));
                    this.render(true);
                    break;
                }

                // --- TT MEDSCAN REQUEST ---
                case 'request-medscan': {
                    // Player taps "Request MedScan" on Bio. Posts a chat message
                    // whispered to GMs so they can narratively rule on the
                    // First Aid / Paramedic or Medical Tech / Surgery bonus.
                    const ttCoverage = game.user.getFlag("VirtualAgent", "ttCoverage") || "";
                    if (!ttCoverage) {
                        ui.notifications.warn("Trauma Team: No active coverage on file.");
                        return;
                    }
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    if (gmIds.length === 0) {
                        ui.notifications.warn("Trauma Team: No System Admin online to take the request.");
                        return;
                    }
                    const userHandle = (game.user.getFlag("VirtualAgent", "idOverrides")?.handle) || game.user.name;
                    const body = `<div style="border:1px solid #ff3333; padding:8px; border-radius:6px; background:rgba(255,51,51,0.06);"><strong style="color:#ff3333;">TRAUMA TEAM MEDSCAN REQUEST</strong><br><span style="color:#aaa; font-size:0.85em;">Coverage tier:</span> <strong>${ttCoverage}</strong><br><span style="color:#aaa; font-size:0.85em;">From:</span> <strong>${userHandle}</strong><br><em style="color:#888; font-size:0.85em;">GM: rule on First Aid / Paramedic or Medical Tech / Surgery bonus narratively.</em></div>`;
                    await ChatMessage.create({
                        content: body,
                        speaker: { alias: `${userHandle} → Trauma Team` },
                        whisper: gmIds,
                        flags: { VirtualAgent: { isAgentMessage: false, medScanRequest: true } }
                    });
                    ui.notifications.info("Trauma Team: MedScan request sent to GM.");
                    break;
                }

                case 'rep-edit-npc': {
                    // NuNu packaging: edits the role label only. The name lives on the contact itself.
                    if (!game.user.isGM) break;
                    const id = String($(ev.currentTarget).data('npc-id') || "");
                    const who = String($(ev.currentTarget).data('npc-name') || "");
                    if (!id) break;
                    let cur = {};
                    try { const raw = game.settings.get("VirtualAgent", "contactMeta"); cur = typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {}); } catch (e) { cur = {}; }
                    const role = cur[id]?.role || "";
                    new Dialog({
                        title: `Role: ${who}`,
                        content: `<form><div class="form-group"><label>Role</label><input type="text" name="role" value="${_agentEscHTML(role)}" placeholder="Fixer, Ripperdoc, Detective…"></div></form>`,
                        buttons: {
                            save: { label: "Save", callback: async (h) => {
                                const v = h[0].querySelector('[name="role"]').value.trim();
                                cur[id] = { ...(cur[id] || {}), role: v };
                                await game.settings.set("VirtualAgent", "contactMeta", JSON.stringify(cur));
                                this.render(true);
                            } },
                            cancel: { label: "Cancel" },
                        },
                        default: "save",
                    }, { width: 340 }).render(true);
                    break;
                }

                case 'rep-open-messenger': {
                    // NuNu packaging: the book IS the contact list, so this is just a jump.
                    const id = String($(ev.currentTarget).data('npc-id') || "");
                    if (!id) break;
                    this.currentView = 'chat';
                    this.activeContactId = id;
                    this.showAddContact = false;
                    this.editContactId = null;
                    this.render(true);
                    break;
                }

                // --- AUCTION HOUSE ---
                case 'auction-view-detail': {
                    this._auctionDetailId = $(ev.currentTarget).data('auction-id');
                    this._auctionView = 'detail';
                    this.render(true);
                    break;
                }

                case 'auction-back-to-list': {
                    this._auctionView = 'list';
                    this._auctionDetailId = null;
                    this.render(true);
                    break;
                }

                case 'auction-place-npc-bid': {
                    // Patch4 (Gotto Goho): GM-only path to record a bid placed
                    // by an off-screen NPC (a fixer, a corp agent, a rival fixer
                    // running in absentia). Player UX is unchanged; this just
                    // adds an explicit "NPC bid" button that prompts for a name.
                    // Patch4.6: open in-phone modal instead of Foundry Dialog.
                    if (!game.user.isGM) return;
                    const aId = $(ev.currentTarget).data('auction-id');
                    const bidInput = html.find('#auction-bid-amount');
                    const bidIncrement = parseInt(bidInput.val());
                    if (isNaN(bidIncrement) || bidIncrement <= 0) {
                        ui.notifications.warn("Agent Auction: Enter a valid bid amount before placing the NPC bid.");
                        break;
                    }
                    this._pendingNpcBid = { auctionId: aId, increment: bidIncrement };
                    this.showNpcBidModal = true;
                    this.render(true);
                    break;
                }

                case 'cancel-npc-bid': {
                    this.showNpcBidModal = false;
                    this._pendingNpcBid = null;
                    this.render(true);
                    break;
                }

                case 'cancel-pending': {
                    // Patch4.6: dismiss the generic in-phone confirm modal.
                    this._pendingConfirm = null;
                    this.render(true);
                    break;
                }

                case 'confirm-pending': {
                    // Patch4.6: dispatch the generic confirm modal's "yes" path.
                    const pending = this._pendingConfirm;
                    if (!pending) { this.render(true); break; }
                    this._pendingConfirm = null;
                    try {
                        if (pending.kind === 'delete-message') {
                            const msg = game.messages.get(pending.payload?.msgId);
                            if (msg) await msg.delete();
                        } else if (pending.kind === 'delete-contact') {
                            const id = pending.payload?.contactId;
                            if (id) {
                                // Remove from customContacts (stored NPC contacts)
                                let mine = game.user.getFlag("VirtualAgent", "customContacts") || [];
                                if (mine.some(c => c.id === id)) {
                                    mine = mine.filter(c => c.id !== id);
                                    await game.user.setFlag("VirtualAgent", "customContacts", mine);
                                }
                                // Patch4.7: clear any orphan unreads for this thread so
                                // the home-screen badge doesn't keep ringing.
                                const cur = game.user.getFlag("VirtualAgent", "unreads") || {};
                                if (Object.prototype.hasOwnProperty.call(cur, id)) {
                                    const next = { ...cur };
                                    delete next[id];
                                    await game.user.setFlag("VirtualAgent", "unreads", next);
                                }
                                // GM: also nuke switchboard-generated NPC threads + push removal to players
                                if (game.user.isGM && String(id).startsWith("npc_")) {
                                    const threadMsgs = game.messages.filter(m =>
                                        m.flags?.VirtualAgent?.isAgentMessage && m.flags.VirtualAgent.threadId === id
                                    );
                                    if (threadMsgs.length > 0) {
                                        await ChatMessage.deleteDocuments(threadMsgs.map(m => m.id));
                                    }
                                    for (const u of game.users) {
                                        if (u.id === game.user.id) continue;
                                        let playerContacts = u.getFlag("VirtualAgent", "customContacts") || [];
                                        if (playerContacts.some(c => c.id === id)) {
                                            playerContacts = playerContacts.filter(c => c.id !== id);
                                            await u.setFlag("VirtualAgent", "customContacts", playerContacts);
                                        }
                                    }
                                }
                            }
                        }
                    } catch (err) {
                        console.error("AgentDevice | confirm-pending dispatch failed:", err);
                        ui.notifications.error("Agent: Action failed — see console.");
                    }
                    this.render(true);
                    break;
                }

                case 'confirm-npc-bid': {
                    if (!game.user.isGM) return;
                    const npcName = (html.find('#npc-bidder-name').val() || "").trim();
                    if (!npcName) {
                        ui.notifications.warn("Agent Auction: NPC bidder name required.");
                        return;
                    }
                    const pending = this._pendingNpcBid;
                    if (!pending) { this.showNpcBidModal = false; this.render(true); break; }
                    const aId = pending.auctionId;
                    const bidIncrement = pending.increment;
                    this.showNpcBidModal = false;
                    this._pendingNpcBid = null;
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
                    const auc = auctions.find(a => a.id === aId);
                    if (!auc) { ui.notifications.warn("Agent Auction: Listing not found."); this.render(true); break; }
                    if (auc.settled || (auc.endTime && Date.now() > auc.endTime)) {
                        ui.notifications.warn("Agent Auction: This auction has ended.");
                        this.render(true);
                        break;
                    }
                    const newTotal = (auc.currentBid || 0) + bidIncrement;
                    auc.currentBid = newTotal;
                    auc.highBidderId = `npc:${foundry.utils.randomID()}`;
                    auc.highBidderName = npcName.slice(0, 60);
                    auc.bidCount = (auc.bidCount || 0) + 1;
                    auc.isNpcBid = true;
                    this._pendingAuctionData = auctions;
                    ui.notifications.info(`Agent Auction: NPC bid recorded — ${npcName} +${bidIncrement}eb (new total ${newTotal}eb).`);
                    this.render(true);
                    game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(auctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
                    }).catch(err => {
                        console.error("Agent Auction | npc-bid save failed:", err);
                        this._pendingAuctionData = null;
                        ui.notifications.error("Agent Auction: Failed to save NPC bid.");
                        this.render(true);
                    });
                    break;
                }

                case 'auction-place-bid': {
                    const aId = $(ev.currentTarget).data('auction-id');
                    const bidInput = html.find('#auction-bid-amount');
                    const bidIncrement = parseInt(bidInput.val());
                    if (isNaN(bidIncrement) || bidIncrement <= 0) {
                        ui.notifications.warn("Agent Auction: Enter a valid bid amount.");
                        break;
                    }
                    const bidPayload = {
                        action: "auctionBid",
                        auctionId: aId,
                        bidderId: game.user.id,
                        // Patch3: requesterId == bidderId is the integrity check; GM-side
                        // rejects payloads where the two disagree. Stops trivial impersonation.
                        requesterId: game.user.id,
                        bidderName: (game.user.getFlag("VirtualAgent", "idOverrides")?.handle) || game.user.name,
                        bidIncrement: bidIncrement,
                        actorUuid: this.actorUuid
                    };
                    if (game.user.isGM) {
                        // GM bids process locally — socket.emit doesn't loop back to sender
                        let auctions = [];
                        try { auctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
                        const auc = auctions.find(a => a.id === aId);
                        if (!auc) { ui.notifications.warn("Agent Auction: Listing not found."); break; }
                        if (auc.settled || (auc.endTime && Date.now() > auc.endTime)) {
                            ui.notifications.warn("Agent Auction: This auction has ended.");
                            break;
                        }
                        // Bid is an increment: current 100 + bid 10 = new total 110
                        const newTotal = (auc.currentBid || 0) + bidIncrement;
                        auc.currentBid = newTotal;
                        auc.highBidderId = game.user.id;
                        auc.highBidderName = bidPayload.bidderName;
                        auc.bidCount = (auc.bidCount || 0) + 1;
                        const updatedJSON = JSON.stringify(auctions);
                        // Optimistic UI: render with local data immediately, then persist
                        this._pendingAuctionData = auctions;
                        ui.notifications.info(`Agent Auction: +${bidIncrement}eb — new total ${newTotal}eb.`);
                        this.render(true);
                        game.settings.set("VirtualAgent", "auctionListings", updatedJSON).then(() => {
                            this._pendingAuctionData = null;
                            game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
                        }).catch(err => {
                            console.error("Agent Auction | settings.set FAILED:", err);
                            this._pendingAuctionData = null;
                            ui.notifications.error("Agent Auction: Failed to save bid.");
                            this.render(true);
                        });
                    } else {
                        // Players send bid to GM for processing
                        game.socket.emit("module.VirtualAgent", bidPayload);
                        ui.notifications.info(`Agent Auction: Bid of +${bidIncrement}eb sent.`);
                    }
                    break;
                }

                case 'auction-create': {
                    if (!game.user.isGM) return;
                    const aName = html.find('#auction-item-name').val()?.trim();
                    const aDesc = html.find('#auction-item-desc').val()?.trim() || "";
                    const aStart = parseInt(html.find('#auction-start-bid').val()) || 100;
                    const aHrs = parseInt(html.find('#auction-duration-hrs').val()) || 0;
                    const aMins = parseInt(html.find('#auction-duration-min').val()) || 0;
                    const totalMs = (aHrs * 3600000) + (aMins * 60000);
                    if (!aName) { ui.notifications.warn("Agent Auction: Enter an item name."); break; }
                    if (totalMs <= 0) { ui.notifications.warn("Agent Auction: Duration must be at least 1 minute."); break; }
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
                    auctions.push({
                        id: "auc_" + foundry.utils.randomID(),
                        name: aName,
                        description: aDesc,
                        startingBid: aStart,
                        currentBid: aStart,
                        highBidderId: null,
                        highBidderName: null,
                        bidCount: 0,
                        createdAt: Date.now(),
                        endTime: Date.now() + totalMs,
                        settled: false
                    });
                    // Format display string
                    const dispParts = [];
                    if (aHrs > 0) dispParts.push(`${aHrs}h`);
                    if (aMins > 0) dispParts.push(`${aMins}m`);
                    // Optimistic UI: render with local data immediately, then persist
                    this._pendingAuctionData = auctions;
                    ui.notifications.info(`Agent Auction: "${aName}" listed for ${dispParts.join(' ')}.`);
                    this.render(true);
                    game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(auctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
                    });
                    break;
                }

                case 'auction-end-now': {
                    if (!game.user.isGM) return;
                    const endId = $(ev.currentTarget).data('auction-id');
                    let endAuctions = [];
                    try { endAuctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
                    const endAuc = endAuctions.find(a => a.id === endId);
                    if (!endAuc) break;
                    endAuc.endTime = Date.now() - 1; // force expired
                    this._pendingAuctionData = endAuctions;
                    ui.notifications.info(`Agent Auction: "${endAuc.name}" ended by GM.`);
                    this.render(true);
                    game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(endAuctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
                    });
                    break;
                }

                case 'auction-settle': {
                    if (!game.user.isGM) return;
                    const settleId = $(ev.currentTarget).data('auction-id');
                    await this._settleAuction(settleId);
                    break;
                }

                case 'auction-cancel': {
                    if (!game.user.isGM) return;
                    const cancelId = $(ev.currentTarget).data('auction-id');
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
                    auctions = auctions.filter(a => a.id !== cancelId);
                    // Optimistic UI: render with local data immediately, then persist
                    this._pendingAuctionData = auctions;
                    this._auctionView = 'list'; this._auctionDetailId = null;
                    ui.notifications.info("Agent Auction: Listing removed.");
                    this.render(true);
                    game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(auctions)).then(() => {
                        this._pendingAuctionData = null;
                        game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
                    });
                    break;
                }

                case 'panic-alert': {
                    // Whisper to GMs only to avoid leaking IC distress to all players
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    ChatMessage.create({
                        content: `<b>EMERGENCY SIGNAL</b>: ${_agentEscHTML(game.user.name)} activated Panic Button!`,
                        speaker: { alias: "Trauma Team" },
                        whisper: gmIds,
                        flags: { VirtualAgent: { isAgentMessage: false, isPanic: true } }
                    });
                    ui.notifications.warn("Agent: Trauma Team alerted.");
                    break;
                }

                case 'panic-meatwagon': {
                    // Patch5.5.5: REO Meatwagon button — same alert pipeline as
                    // Trauma Team, just routed under the "Meatwagon" alias.
                    // Players without TT coverage still get a panic option, and
                    // it's a fat hook for the GM to roleplay a scrap-grade
                    // ambulance call instead of leaving them with no out.
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    const handle = (game.user.getFlag("VirtualAgent", "idOverrides")?.handle) || game.user.name;
                    ChatMessage.create({
                        content: `<div style="border:1px solid #aa6600; padding:8px; border-radius:6px; background:rgba(255,153,0,0.08);"><b style="color:#ff9900;">REO MEATWAGON CALL</b><br><span style="color:#aaa; font-size:0.85em;">No TT coverage on file.</span><br><span style="color:#aaa; font-size:0.85em;">From:</span> <b>${_agentEscHTML(handle)}</b><br><em style="color:#888; font-size:0.85em;">GM: a beat-up scrap-grade ambulance is dispatched — narrate accordingly. ETA, cost, and competence are at your discretion.</em></div>`,
                        speaker: { alias: `${handle} → REO Meatwagon` },
                        whisper: gmIds,
                        flags: { VirtualAgent: { isAgentMessage: false, isPanic: true, isMeatwagon: true } }
                    });
                    ui.notifications.warn("Agent: REO Meatwagon dispatched. Cross your fingers.");
                    break;
                }

                case 'switch-actor': {
                    const newUuid = $(ev.currentTarget).data('actor-uuid');
                    if (!newUuid || newUuid === this.actorUuid) break;
                    await game.user.setFlag("VirtualAgent", "lastActorUuid", newUuid);
                    this.actorUuid = newUuid;
                    ui.notifications.info(`Virtual Agent: Identity switched to ${this._resolveActor(newUuid)?.name || "unknown"}`);
                    this.render(true);
                    break;
                }

                case 'edit-agent-id': {
                    // Patch4.5: open the in-phone modal instead of the
                    // immersion-breaking Foundry Dialog popup.
                    if (!game.user.isGM) {
                        ui.notifications.warn("Agent ID: Only the GM can edit ID cards.");
                        break;
                    }
                    const targetUserId = this._idViewTargetUserId;
                    const targetUser = targetUserId ? game.users.get(targetUserId) : null;
                    if (!targetUser) {
                        ui.notifications.warn("Agent ID: No player selected.");
                        break;
                    }
                    // Patch4.7.2 (Gotto): the form fields use data-preserve-draft,
                    // which stashes user input in `_composerDrafts` so a stray
                    // re-render doesn't wipe what the GM just typed. Side effect:
                    // opening edit on player A, then on player B, restored A's
                    // typed values into B's form. Reset the drafts to the target
                    // player's CURRENT saved overrides every time edit is opened
                    // so each open starts fresh against the right player.
                    const eOver = targetUser.getFlag("VirtualAgent", "idOverrides") || {};
                    if (!this._composerDrafts) this._composerDrafts = {};
                    this._composerDrafts['id-edit-display-name'] = eOver.displayName || "";
                    this._composerDrafts['id-edit-handle']       = eOver.handle      || "";
                    this._composerDrafts['id-edit-subtitle']     = eOver.subtitle    || "";
                    this._composerDrafts['id-edit-sin']          = eOver.sinStatus   || "Registered";
                    this._composerDrafts['id-edit-clearance']    = eOver.clearance   || "";
                    this.showIdEditModal = true;
                    this.render(true);
                    break;
                }

                case 'save-agent-id': {
                    if (!game.user.isGM) return;
                    const targetUserId = this._idViewTargetUserId;
                    const targetUser = targetUserId ? game.users.get(targetUserId) : null;
                    if (!targetUser) {
                        ui.notifications.warn("Agent ID: No player selected.");
                        break;
                    }
                    const result = {
                        displayName: (html.find('#id-edit-display-name').val() || "").trim(),
                        handle:      (html.find('#id-edit-handle').val() || "").trim(),
                        subtitle:    (html.find('#id-edit-subtitle').val() || "").trim() || "Citizen Priority A+",
                        sinStatus:   html.find('#id-edit-sin').val() || "Registered",
                        clearance:   (html.find('#id-edit-clearance').val() || "").trim() || "Verified"
                    };
                    await targetUser.setFlag("VirtualAgent", "idOverrides", result);
                    this.showIdEditModal = false;
                    // Patch4.7.2: scrub the form drafts so the next open is clean.
                    if (this._composerDrafts) {
                        ['id-edit-display-name','id-edit-handle','id-edit-subtitle','id-edit-sin','id-edit-clearance']
                            .forEach(k => delete this._composerDrafts[k]);
                    }
                    ui.notifications.info(`Agent ID: Saved for ${targetUser.name}.`);
                    this.render(true);
                    break;
                }

                case 'cancel-agent-id': {
                    this.showIdEditModal = false;
                    // Patch4.7.2: scrub drafts so the next open of edit on a
                    // different player doesn't carry over the cancelled values.
                    if (this._composerDrafts) {
                        ['id-edit-display-name','id-edit-handle','id-edit-subtitle','id-edit-sin','id-edit-clearance']
                            .forEach(k => delete this._composerDrafts[k]);
                    }
                    this.render(true);
                    break;
                }

                case 'id-select-player': {
                    const playerId = ev.currentTarget.dataset.playerId;
                    if (playerId) {
                        this._idViewTargetUserId = playerId;
                        this.render(true);
                    }
                    break;
                }

                case 'open-shard-modal':
                    if (!game.user.isGM) return;
                    this.showShardModal = true; this.render(true);
                    break;

                case 'cancel-shard':
                    this.showShardModal = false; this.render(true);
                    break;
            }
        });

        // 5.6.1 SKILLS search — filter in-place (no re-render) so input keeps focus + cursor.
        // Roll buttons get a data-skill-name attribute matched against the lowercase query.
        html.on('input', '#skill-search-input', (ev) => {
            const q = (ev.currentTarget.value || '').toLowerCase();
            this._skillSearch = q;
            html.find('.skill-row').each((_, el) => {
                const name = (el.dataset.skillName || '').toLowerCase();
                el.style.display = (!q || name.includes(q)) ? '' : 'none';
            });
        });

        // 1.2.0 — whole-Agent scale: a corner-drag grip adjusts the WINDOW scale via
        // Application.setPosition({scale}); the 380x680 internal layout is untouched. The scale
        // is persisted per device so a player on a small/high-DPI screen can size the Agent up.
        // Double-click the grip to reset to 1:1.
        // 1.7.4 — "Agent locked in a weird size after resize + close/reopen".
        // Foundry's Application#setPosition clamps height to (window.innerHeight / scale).
        // Scaling past what the viewport can fit therefore OVERWROTE position.height with
        // the clamped value permanently: width scaled (380*s still fits) while height got
        // crushed, so the device came back wide + squashed with the app grid cut off — and
        // it stayed that way, because the Application is a singleton and the bad height
        // survived close/reopen. Two-part fix: (1) never allow a scale whose scaled height
        // can't fit the viewport, so the clamp never triggers; (2) always re-assert the
        // canonical 380x680 alongside the scale, so an already-corrupted height heals.
        const _BASE_W = 380, _BASE_H = 680;
        const _fitScale = () => Math.max(0.7, Math.min(
            (window.innerHeight * 0.98) / _BASE_H,
            (window.innerWidth * 0.98) / _BASE_W
        ));
        const _clampScale = (s) => Math.max(0.7, Math.min(2.5, _fitScale(), Number(s) || 1));
        const _applyScale = (s) => this.setPosition({ scale: s, width: _BASE_W, height: _BASE_H });

        const _grip = html.find('.agent-resize-grip');
        if (_grip.length) {
            // 1.8.1 — pointer events instead of mouse events: works for touch (phones/
            // tablets) too. CSS touch-action:none on the grip stops scroll hijacking.
            _grip.on('pointerdown', (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                const startX = ev.clientX, startY = ev.clientY;
                const startScale = this._agentScale || 1;
                const onMove = (e) => {
                    // average the diagonal drag (screen px) so the corner pull feels uniform
                    const delta = ((e.clientX - startX) + (e.clientY - startY)) / 2;
                    const s = _clampScale(startScale + delta / 360);  // ~360px of drag ≈ +1.0 scale
                    this._agentScale = s;
                    _applyScale(s);
                };
                const onUp = () => {
                    window.removeEventListener('pointermove', onMove);
                    window.removeEventListener('pointerup', onUp);
                    window.removeEventListener('pointercancel', onUp);
                    try { game.settings.set('VirtualAgent', 'agentScale', this._agentScale); } catch (e) {}
                };
                window.addEventListener('pointermove', onMove);
                window.addEventListener('pointerup', onUp);
                window.addEventListener('pointercancel', onUp);
            });
            _grip.on('dblclick', (ev) => {
                ev.preventDefault(); ev.stopPropagation();
                this._agentScale = 1;
                _applyScale(1);
                try { game.settings.set('VirtualAgent', 'agentScale', 1); } catch (e) {}
            });
        }
        // Re-assert the saved scale + canonical size on every render. Always (even at 1:1)
        // so a height corrupted by a pre-1.7.4 over-scale is repaired on next open.
        _applyScale(_clampScale(this._agentScale || 1));

        // 5.8.6 custom modifier input + add button
        html.on('input', '#skill-prep-custom-input', (ev) => {
            if (!this._skillRollPrep) return;
            const v = parseInt(ev.currentTarget.value, 10);
            this._skillRollPrep._customDraft = Number.isFinite(v) ? v : 0;
        });
        html.on('click', '#skill-prep-custom-add', (ev) => {
            ev.preventDefault();
            if (!this._skillRollPrep) return;
            const v = Number(this._skillRollPrep._customDraft || 0);
            if (v !== 0) {
                this._skillRollPrep.modifier += v;
                this._skillRollPrep._customDraft = 0;
                this.render(true);
            }
        });

        html.on('click', '.skill-search-clear', (ev) => {
            ev.preventDefault();
            this._skillSearch = '';
            const input = html.find('#skill-search-input')[0];
            if (input) { input.value = ''; input.focus(); }
            html.find('.skill-row').css('display', '');
        });

        // Store search — debounced re-render so getData does the actual filter.
        // Server-side filter is what's verified working; DOM toggle was unreliable.
        html.on('input', '#store-search-input', (ev) => {
            const raw = ev.currentTarget.value || "";
            this._storeSearch = raw;
            console.log("[Virtual Agent] store-search input:", JSON.stringify(raw));
            clearTimeout(this._storeSearchDebounce);
            this._storeSearchDebounce = setTimeout(() => {
                if (this.rendered && this.currentView === 'store' && this._storeView === 'list') {
                    this.render(false);
                }
            }, 180);
        });

        // Bind via keyup too (some browser/Foundry combos don't bubble input events here)
        html.on('keyup', '#store-search-input', (ev) => {
            const raw = ev.currentTarget.value || "";
            if (raw === this._storeSearch) return;
            this._storeSearch = raw;
            clearTimeout(this._storeSearchDebounce);
            this._storeSearchDebounce = setTimeout(() => {
                if (this.rendered && this.currentView === 'store' && this._storeView === 'list') {
                    this.render(false);
                }
            }, 180);
        });

        // Restore focus + cursor to end after a search-triggered render so typing flow continues.
        // Patch5.0.2 (Ryouhi): use `el.ownerDocument.activeElement` not the
        // top-level `document` so this works correctly when the app is
        // popped out into a second browser window via the Pop Out! module.
        const _ss = html.find('#store-search-input')[0];
        if (_ss && this._storeSearch && _ss.ownerDocument?.activeElement !== _ss) {
            _ss.focus();
            try { _ss.setSelectionRange(_ss.value.length, _ss.value.length); } catch (e) {}
        }

        // Restore NuNu Mart scroll position for the current category
        const _storeListEl = html.find('.store-item-list')[0];
        if (_storeListEl && this._storeCategory && this._storeScrollPositions[this._storeCategory]) {
            _storeListEl.scrollTop = this._storeScrollPositions[this._storeCategory];
        }

        // Patch3.3: restore scroll positions of long admin/list containers so
        // toggling items (e.g. Sys Admin app-lock toggles, NuNu Mart GM-controls
        // edits) doesn't snap the view back to the top.
        // Patch4 round 2: do this BOTH synchronously and again on the next
        // animation frame. The synchronous pass handles content that already
        // measured; the rAF pass catches flex children whose final height
        // wasn't known until layout completed (which is why tab clicks were
        // still snapping to the top even though the restore code existed).
        const _restoreScroll = () => {
            if (!this._scrollPositions) return;
            for (const [sel, top] of Object.entries(this._scrollPositions)) {
                const el = html.find(sel)[0];
                if (el && top > 0) el.scrollTop = top;
            }
        };
        _restoreScroll();
        requestAnimationFrame(() => { _restoreScroll(); requestAnimationFrame(_restoreScroll); });
        setTimeout(_restoreScroll, 50);
        setTimeout(_restoreScroll, 150);

        // Patch3 (your own list): NuNu Mart category bar "snap-back" — after a
        // re-render the bar's horizontal scroll resets to 0, hiding the active
        // tab if it was off-screen. Bring the active category into view.
        const _catBar = html.find('.store-category-bar')[0];
        const _catActive = _catBar && _catBar.querySelector('.store-cat-btn.active');
        if (_catBar && _catActive) {
            const barRect = _catBar.getBoundingClientRect();
            const btnRect = _catActive.getBoundingClientRect();
            if (btnRect.right > barRect.right || btnRect.left < barRect.left) {
                _catBar.scrollTo({
                    left: _catActive.offsetLeft - (_catBar.clientWidth / 2) + (_catActive.offsetWidth / 2),
                    behavior: 'auto'
                });
            }
        }

        // Datapool Search — client-side filter, no re-render (preserves input focus)
        html.on('input', '#shard-search-input', ev => {
            this.shardSearchQuery = ev.target.value || "";
            const q = this.shardSearchQuery.toLowerCase();
            html.find('.shard-item').each(function () {
                const name = ($(this).find('.shard-title').text() || "").toLowerCase();
                $(this).toggle(!q || name.includes(q));
            });
        });

        // Clicking a Shard to Read
        html.on('click', '.shard-item', ev => {
            if ($(ev.target).closest('[data-action="delete-shard"]').length) return;
            const sid = $(ev.currentTarget).data('shard-id');
            let shard = null;
            if (game.user.isGM) {
                // GM: search all users' shards
                for (const user of game.users) {
                    const userShards = user.getFlag("VirtualAgent", "shards") || [];
                    shard = userShards.find(s => s.id === sid);
                    if (shard) break;
                }
            } else {
                const shards = game.user.getFlag("VirtualAgent", "shards") || [];
                shard = shards.find(s => s.id === sid);
            }
            if (shard) {
                this.activeShardId = sid;
                this.activeShardName = shard.name;
                this.activeShardContent = shard.content;
                this.currentView = 'reader';
                this.render(true);
            }
        });

        // Messaging
        html.on('click', '.contact-card', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            this.activeContactId = $(ev.currentTarget).data('contact-id');
            let unreads = game.user.getFlag("VirtualAgent", "unreads") || {};
            if (unreads[this.activeContactId]) {
                unreads[this.activeContactId] = 0;
                await game.user.setFlag("VirtualAgent", "unreads", unreads);
            }
            this.currentView = 'chat-thread';
            this.render(true);
        });

        html.on('click', '#agent-chat-send', async ev => {
            ev.preventDefault(); ev.stopPropagation();
            let input = html.find('#agent-chat-input');
            let raw = (input.val() || "").trim();
            if (!raw || !this.activeContactId) return;
            const content = foundry.utils.escapeHTML
                ? foundry.utils.escapeHTML(raw).replace(/\n/g, '<br>')
                : raw.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])).replace(/\n/g, '<br>');
            // Resolve display name + routing for the current thread
            const contacts = this._getContacts();
            const threadContact = contacts.find(c => c.id === this.activeContactId);
            const isNpcThread = this.activeContactId?.startsWith("npc_");

            // Patch4.8.3: if GM is in a custom group thread AND has picked an
            // NPC voice via the speak-as switcher, override the speaker to
            // that NPC. Picker stores the raw NPC id ("npc_abc..."), with the
            // sentinel "gm" meaning "speak as GM (default)".
            let groupNpcOverride = null;
            const _isCustomGroup = !!threadContact?.isCustomGroup;
            if (game.user.isGM && _isCustomGroup && this._gmSpeakingAsInThread) {
                const cur = this._gmSpeakingAsInThread[this.activeContactId];
                if (cur && cur !== "gm") {
                    // Lookup the picked NPC contact across all user lists
                    // (any GM-authored NPC can be voiced even if it lives on
                    // a player's device).
                    for (const u of game.users) {
                        const lst = u.getFlag("VirtualAgent", "customContacts") || [];
                        const match = lst.find(c => c.id === cur);
                        if (match) { groupNpcOverride = match; break; }
                    }
                }
            }

            const speakerAlias = (game.user.isGM && isNpcThread && threadContact)
                ? (threadContact.originalName || threadContact.name)
                : (groupNpcOverride
                    ? (groupNpcOverride.originalName || groupNpcOverride.name)
                    : (game.user.name + " (Agent)"));

            const npcOverrideName = (game.user.isGM && isNpcThread && threadContact)
                ? (threadContact.originalName || threadContact.name)
                : (groupNpcOverride ? (groupNpcOverride.originalName || groupNpcOverride.name) : undefined);
            // 5.5.27 (live-Foundry screenshot): cross-user avatar resolution. See
            // attachment-send block for the full reasoning — same lookup applies
            // to the regular text-send path. Preserves the existing
            // groupNpcOverride pathway for GM-voiced custom group threads.
            let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar) ? threadContact.avatar : null;
            if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
                for (const u of game.users) {
                    const lst = u.getFlag("VirtualAgent", "customContacts") || [];
                    const m = lst.find(c => c.id === this.activeContactId);
                    if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
                }
            }
            const npcOverrideAvatar = _resolvedNpcAvatar
                || (groupNpcOverride?.avatar || undefined);
            let messageData = {
                content: content,
                speaker: { alias: speakerAlias },
                flags: {
                    VirtualAgent: {
                        isAgentMessage: true,
                        threadId: this.activeContactId,
                        overrideName: npcOverrideName,
                        overrideAvatar: npcOverrideAvatar,
                        targetName: threadContact?.name
                    }
                }
            };
            if (this.activeContactId !== 'party_group_chat') {
                // Patch4.8: custom group threads (pcgroup_* id, isCustomGroup:true)
                // route the whisper to every player member + all GMs. NPC
                // members are conceptually part of the group but have no user
                // record — their "voice" is the GM's, who's already covered.
                if (this.activeContactId?.startsWith("pcgroup_") || threadContact?.isCustomGroup) {
                    const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                    const targets = new Set(gmIds);
                    targets.add(game.user.id); // include self for loopback render
                    const members = Array.isArray(threadContact?.members) ? threadContact.members : [];
                    for (const m of members) {
                        if (m.startsWith("player:")) targets.add(m.slice("player:".length));
                    }
                    messageData.whisper = Array.from(targets);
                } else if (game.users.get(this.activeContactId)) {
                    // DM to another user
                    messageData.whisper = [this.activeContactId];
                } else if (isNpcThread) {
                    // NPC thread routing
                    if (game.user.isGM) {
                        // GM replying as NPC: whisper to every player the contact is targeted to,
                        // any prior owner detected by the dynamic switchboard, plus other GMs.
                        const gmIds = game.users.filter(u => u.isGM).map(u => u.id);
                        const targets = new Set(gmIds);
                        const tList = Array.isArray(threadContact?.targetUserIds) ? threadContact.targetUserIds : [];
                        for (const uid of tList) targets.add(uid);
                        if (threadContact?.ownerId) targets.add(threadContact.ownerId);
                        messageData.whisper = Array.from(targets);
                    } else {
                        // Player messaging an NPC: whisper to all GMs
                        messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                    }
                } else if (!game.user.isGM) {
                    messageData.whisper = game.users.filter(u => u.isGM).map(u => u.id);
                }
            }
            this._emitTypingStop();
            this._chatNearBottom = true;
            this._forceScrollOnNextRender = true;
            this._chatInputDraft = "";
            input.val('');
            this._autoGrowInput(input[0]);
            await ChatMessage.create(messageData);
        });

        // --- Realistic-texting wiring ---
        html.on('keydown', '#agent-chat-input', (ev) => {
            if (ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
                ev.preventDefault();
                html.find('#agent-chat-send').trigger('click');
            }
        });
        html.on('input', '#agent-chat-input', (ev) => {
            this._autoGrowInput(ev.currentTarget);
            this._chatInputDraft = ev.currentTarget.value || "";
            if ((ev.currentTarget.value || "").trim().length > 0) this._emitTyping();
            else this._emitTypingStop();
        });
        html.on('blur', '#agent-chat-input', () => this._emitTypingStop());

        // --- Delete chat message ---
        html.on('click', '.delete-chat-msg', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const msgId = $(ev.currentTarget).data('msg-id');
            if (!msgId) return;
            const msg = game.messages.get(msgId);
            if (!msg) return;
            const canDelete = msg.author?.id === game.user.id || game.user.isGM;
            if (!canDelete) { ui.notifications.warn("Agent: Cannot purge this record."); return; }
            // Patch4.6: in-phone confirm modal instead of Foundry Dialog.
            this._pendingConfirm = {
                kind: 'delete-message',
                payload: { msgId },
                title: "PURGE RECORD",
                message: "Delete this message permanently?",
                confirmLabel: "PURGE",
                accent: "red"
            };
            this.render(true);
        });

        // Close button
        html.on('mousedown click', '.agent-close-btn', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (ev.type !== 'click') return;
            this._emitTypingStop?.();
            this.close();
        });

        // --- Contact Management ---
        // Patch3 (CommanderCrunch69): Fixers app sort dropdown.
        html.on('change', '#rep-sort-select', (ev) => {
            this._repSort = ev.currentTarget.value || "default";
            this.render(false);
        });

        // Patch4.7 (Gotto): NuNu Mart price-tier dropdown. Bound on `change`
        // because the global data-action switch only listens for clicks.
        html.on('change', '#store-price-tier-select', (ev) => {
            this._storePriceTier = String(ev.currentTarget.value || "all");
            this.render(true);
        });

        // Patch4.8.3: GM speak-as switcher in multi-NPC group threads.
        html.on('change', '#gm-group-voice-select', (ev) => {
            if (!game.user.isGM || !this.activeContactId) return;
            const voice = String(ev.currentTarget.value || "gm");
            this._gmSpeakingAsInThread = this._gmSpeakingAsInThread || {};
            this._gmSpeakingAsInThread[this.activeContactId] = voice;
            this.render(true);
        });

        // Patch3 (CommanderCrunch69 / Forge VTT): launch Foundry's FilePicker for the
        // contact avatar so paths resolve correctly across Forge / Bazaar / local servers
        // instead of relying on the user pasting a copy-pasted folder path.
        html.on('click', '.pick-contact-avatar', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            // 5.5.26: hard permission gate — even if the button somehow
            // survives the template gate, refuse to render the FilePicker
            // when the user doesn't have FILES_BROWSE. Stops the "click does
            // nothing / silent fail" we saw in 5.5.25.
            let canBrowse = false;
            try { canBrowse = !!game.user.can?.("FILES_BROWSE"); }
            catch (e) { canBrowse = game.user.isGM; }
            if (!canBrowse) {
                ui.notifications.warn("Virtual Agent: BROWSE needs Foundry's FILES_BROWSE permission. Ask your GM to enable it in Configure Permissions, or use IMPORT to pull a portrait from a world Actor instead.");
                return;
            }
            const input = html.find('#new-contact-avatar')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/",
                    callback: (path) => { if (input) input.value = path; }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Virtual Agent: FilePicker unavailable — paste the path manually, or use IMPORT to pull a portrait from a world Actor.");
                console.error(e);
            }
        });

        // 5.5.24 (CommanderCrunch69 follow-up): player-facing import button.
        // Players can't open Foundry's FilePicker — it's gated by permission
        // flags they don't have — so Browse only ever worked for the GM.
        // IMPORT looks up a world Actor by the name the player typed and
        // pulls that actor's portrait into the avatar field. Works for any
        // actor the player has at least LIMITED permission on. If the GM's
        // NPCs are set to NONE for players the import won't find them; ask
        // the GM to bump default actor permission to LIMITED, or share the
        // path manually.
        html.on('click', '.import-contact-avatar', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const nameInput = html.find('#new-contact-name')[0];
            const avatarInput = html.find('#new-contact-avatar')[0];
            const rawName = (nameInput?.value || "").trim();
            if (!rawName) {
                ui.notifications.warn("Agent: Enter a handle first, then IMPORT to pull a matching world Actor's portrait.");
                return;
            }
            // Strip switchboard '(via Bob)' suffix so "Rogue (via Bob)" still
            // matches a plain "Rogue" actor.
            const cleanName = rawName.replace(/\s*\(via\s+[^)]+\)\s*$/i, "").trim();
            // 5.5.24 follow-up: spoiler-safe scope. Players shouldn't
            // fish for hidden NPC art by typing names — restrict non-GM lookups
            // to actors that have at least LIMITED ownership for the requesting
            // user. GMs see everything (they own it). GM workflow to expose a
            // portrait: open the actor → Permissions → set Default to LIMITED
            // (just the name + image is shared, stats stay hidden). Encounter
            // NPCs and unannounced bosses stay at NONE → invisible to player
            // import → no spoilers.
            const _canSeeForImport = (a) => {
                if (game.user.isGM) return true;
                try { return a.testUserPermission(game.user, "LIMITED"); }
                catch (e) { return false; }
            };
            const matches = (game.actors?.filter?.(a => a.name === cleanName && _canSeeForImport(a))) || [];
            if (matches.length === 0) {
                ui.notifications.warn(`Agent: No portrait found for "${cleanName}". The GM controls which NPCs are visible — ask them to set the actor's Default Permission to LIMITED if they want to share this portrait, or paste an image URL/path manually.`);
                return;
            }
            if (matches.length > 1) {
                ui.notifications.warn(`Agent: Multiple actors named "${cleanName}" — using the first match.`);
            }
            const match = matches[0];
            if (!match.img || match.img === "icons/svg/mystery-man.svg") {
                ui.notifications.warn(`Agent: "${cleanName}" exists but has no portrait set on the actor sheet.`);
                return;
            }
            if (avatarInput) avatarInput.value = match.img;
            if (this._composerDrafts) this._composerDrafts['new-contact-avatar'] = match.img;
            ui.notifications.info(`Agent: Imported portrait for "${cleanName}".`);
        });

        // Patch5.5.20 (Praise Jaheebus): FilePicker hook for the Sys Admin map path
        // input. Users were typing absolute Windows paths (C:/Users/...) which
        // Foundry's <img src> can't resolve — Foundry only serves paths relative
        // to the user-data root. FilePicker returns the right format every time.
        html.on('click', '.pick-map-path', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#admin-map-path-input')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "modules/VirtualAgent/assets/night-city-map-red-final-v2.png",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['admin-map-path-input'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Virtual Agent: FilePicker unavailable — paste the Foundry-relative path manually (e.g. worlds/MyWorld/maps/file.png).");
                console.error(e);
            }
        });

        // Patch5.5.12: FilePicker hook for the Garden photo field on the modal.
        html.on('click', '.pick-garden-photo', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#garden-modal-photo')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/svg/mystery-man.svg",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['garden-modal-photo'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Virtual Agent: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        // 1.8.0 — Garden photo upload (players + GM). Opens the browser's own file dialog —
        // NOT Foundry's FilePicker — so players never see the server's asset tree. The image
        // is downscaled client-side; storage happens at submit time (GM uploads directly,
        // players relay the image with the profile and the GM stores it in the locked folder).
        html.on('click', '.garden-photo-upload', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            html.find('.garden-photo-file').trigger('click');
        });
        html.on('change', '.garden-photo-file', async (ev) => {
            const file = ev.currentTarget.files?.[0];
            ev.currentTarget.value = "";   // allow re-picking the same file
            if (!file) return;
            if (!/^image\//.test(file.type)) { ui.notifications.warn("The Garden: images only."); return; }
            if (file.size > 15 * 1024 * 1024) { ui.notifications.warn("The Garden: image too large (15MB max)."); return; }
            try {
                const dataUrl = await this._readGardenImage(file);
                if (dataUrl.length > 1000000) { ui.notifications.warn("The Garden: image is still too large after resizing — try a smaller one."); return; }
                this._gardenPendingPhoto = { dataUrl, label: String(file.name || "photo").slice(0, 60) };
                html.find('.garden-photo-status').html(`&#10003; ${this._gardenPendingPhoto.label} attached`);
            } catch (e) {
                console.warn("[VirtualAgent] garden image read failed:", e);
                ui.notifications.error("The Garden: couldn't read that image.");
            }
        });

        // Patch5.5.12: FilePicker hook for the Ziggurat image field on the modal.
        html.on('click', '.pick-ziggurat-image', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#ziggurat-modal-image')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['ziggurat-modal-image'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Virtual Agent: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        // Patch5.5.12: FilePicker hook for the NCPD mugshot field on the new modal.
        html.on('click', '.pick-ncpd-mugshot', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#ncpd-modal-mugshot')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/svg/mystery-man.svg",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['ncpd-modal-mugshot'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Virtual Agent: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        // Patch4.7 follow-up: same FilePicker hook for the custom-item image field.
        html.on('click', '.pick-custom-item-img', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const input = html.find('#custom-item-img')[0];
            const current = (input && input.value) ? input.value : "";
            try {
                const fp = new FilePicker({
                    type: "image",
                    current: current || "icons/",
                    callback: (path) => {
                        if (input) input.value = path;
                        if (this._composerDrafts) this._composerDrafts['custom-item-img'] = path;
                    }
                });
                fp.render(true);
            } catch (e) {
                ui.notifications.error("Virtual Agent: FilePicker unavailable — paste the path manually.");
                console.error(e);
            }
        });

        html.on('click', '.open-add-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this.editContactId = null;
            this.editContactName = "";
            this.showAddContact = true;
            this.render(true);
        });

        html.on('click', '.cancel-add-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this.showAddContact = false;
            this.editContactId = null;
            this.editContactName = "";
            this.render(true);
        });

        html.on('click', '.confirm-add-contact', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const name = (html.find('#new-contact-name').val() || "").trim();
            if (!name) { ui.notifications.warn("Agent: Contact handle required."); return; }

            if (this.editContactId) {
                if (this.editContactId === "party_group_chat") {
                    // Party/Group chat rename — world setting (GM only)
                    if (game.user.isGM) {
                        await game.settings.set("VirtualAgent", "partyGroupChatName", name);
                    } else {
                        ui.notifications.warn("Agent: Only the GM can rename the group channel.");
                    }
                } else {
                    const editAvatar = html.find('#new-contact-avatar').val()?.trim() || "";
                    let mine = game.user.getFlag("VirtualAgent", "customContacts") || [];
                    mine = mine.map(c => c.id === this.editContactId ? { ...c, name, avatar: editAvatar || c.avatar || null } : c);
                    await game.user.setFlag("VirtualAgent", "customContacts", mine);
                }
            } else {
                // GM may target specific players when creating the NPC contact.
                // We persist that on the contact itself so future GM-sends route correctly.
                const targets = game.user.isGM
                    ? html.find('.new-contact-target-check:checked').map(function () { return this.value; }).get()
                    : [];
                const avatarPath = html.find('#new-contact-avatar').val()?.trim() || "";
                const newContact = {
                    id: "npc_" + foundry.utils.randomID(),
                    name,
                    originalName: name,
                    isPlayer: false,
                    avatar: avatarPath || null,
                    targetUserIds: targets.slice()
                };
                const self = game.user.getFlag("VirtualAgent", "customContacts") || [];
                self.push(newContact);
                await game.user.setFlag("VirtualAgent", "customContacts", self);

                if (game.user.isGM && targets.length > 0) {
                    for (const uid of targets) {
                        const u = game.users.get(uid);
                        if (!u || u.id === game.user.id) continue;
                        const lst = u.getFlag("VirtualAgent", "customContacts") || [];
                        // Patch3: guard against double-push if a previous create-and-undo
                        // left this contact id in the player's flag.
                        if (!lst.some(c => c.id === newContact.id)) {
                            lst.push(newContact);
                            await u.setFlag("VirtualAgent", "customContacts", lst);
                        }
                    }
                    game.socket.emit("module.VirtualAgent", { action: "refreshOnlineStatus" });
                }
                // Patch3: ALSO purge this contact from any NON-target users who may
                // have a stale copy from an earlier targeting. Belt-and-suspenders
                // alongside the read-time filter in _getContacts.
                if (game.user.isGM) {
                    const targetSet = new Set(targets);
                    for (const u of game.users) {
                        if (u.id === game.user.id || u.isGM || targetSet.has(u.id)) continue;
                        let lst = u.getFlag("VirtualAgent", "customContacts") || [];
                        const before = lst.length;
                        lst = lst.filter(c => c.id !== newContact.id);
                        if (lst.length !== before) {
                            await u.setFlag("VirtualAgent", "customContacts", lst);
                        }
                    }
                }
            }

            this.showAddContact = false;
            this.editContactId = null;
            this.editContactName = "";
            this.render(true);
        });

        html.on('click', '.edit-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            this.editContactId = $(ev.currentTarget).data('contact-id');
            this.editContactName = $(ev.currentTarget).data('contact-name') || "";
            this.editContactAvatar = $(ev.currentTarget).data('contact-avatar') || "";
            this.showAddContact = true;
            this.render(true);
        });

        html.on('click', '.delete-contact', (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const id = $(ev.currentTarget).data('contact-id');
            // Patch4.6: in-phone confirm modal instead of Foundry Dialog.
            this._pendingConfirm = {
                kind: 'delete-contact',
                payload: { contactId: id },
                title: "PURGE ENDPOINT",
                message: "Remove this contact and all associated messages from your CitiNet directory?",
                confirmLabel: "PURGE",
                accent: "red"
            };
            this.render(true);
        });

        html.on('input', '#contact-search-input', (ev) => {
            this.searchQuery = ev.currentTarget.value || "";
            const q = this.searchQuery.toLowerCase();
            html.find('.contact-card').each(function () {
                const name = ($(this).find('[data-search-name]').text() || $(this).text() || "").toLowerCase();
                $(this).toggle(!q || name.includes(q));
            });
        });

        html.on('click', '.toggle-online-status', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            const cur = game.user.getFlag("VirtualAgent", "hideOnlineStatus") || false;
            await game.user.setFlag("VirtualAgent", "hideOnlineStatus", !cur);
            game.socket.emit("module.VirtualAgent", { action: "refreshOnlineStatus" });
            this.render(true);
        });

        html.on('click', '.toggle-npc-status', async (ev) => {
            ev.preventDefault(); ev.stopPropagation();
            if (!game.user.isGM) return;
            const cid = $(ev.currentTarget).data('contact-id');
            const gm = game.users.find(u => u.isGM);
            if (!gm) return;
            const statuses = gm.getFlag("VirtualAgent", "npcStatuses") || {};
            statuses[cid] = (statuses[cid] === false);
            await gm.setFlag("VirtualAgent", "npcStatuses", statuses);
            game.socket.emit("module.VirtualAgent", { action: "refreshOnlineStatus" });
            this.render(true);
        });

        // Patch4: #admin-target-selector dropdown was removed in favour of the
        // per-player tab strip; the click handler for that lives in the main
        // data-action switch as 'admin-tab-select'. Old handler deleted here.

        // Boot timer
        // Patch3 round 2: holophone animation is now wired through _render's
        // closed→open transition (see _render), so we no longer fire it here.
        if (this.currentView === 'boot' && !this.bootTimer) {
            this.bootTimer = setTimeout(() => {
                this.currentView = 'home'; this.bootTimer = null; this.render(true);
            }, 1800);
        }

        // Scroll containers (delegated, no leak — element-local listeners die with re-render)
        this._setupScrollDrag(html.find('.chat-window'));
        this._setupScrollDrag(html.find('.contact-list'));
        this._setupScrollDrag(html.find('.transaction-list'));

        // Sticky-to-bottom auto-scroll.
        // Patch2: wrap in rAF so the scroll runs AFTER the browser has laid out
        // the new bubbles. Doing it synchronously here used to read scrollHeight
        // before tall bubbles had measured, leaving the last message visually
        // cropped behind the input area.
        let chatWindow = html.find('.chat-window');
        if (chatWindow.length && (this._forceScrollOnNextRender || this._chatNearBottom !== false)) {
            const el = chatWindow[0];
            const doScroll = () => { el.scrollTop = el.scrollHeight; };
            requestAnimationFrame(() => { doScroll(); requestAnimationFrame(doScroll); });
            this._forceScrollOnNextRender = false;
        }

        // Restore textarea draft + focus
        const taEl = html.find('#agent-chat-input')[0];
        if (taEl) {
            if (this._chatInputDraft) taEl.value = this._chatInputDraft;
            this._autoGrowInput(taEl);
            const freshOpen = (this.currentView === 'chat-thread' && !this._chatInputHadFocus && !this._chatInputDraft);
            if (this._chatInputHadFocus || freshOpen) {
                taEl.focus();
                const len = taEl.value.length;
                try { taEl.setSelectionRange(len, len); } catch (e) {}
            }
        }

        // Restore generic composer drafts (Social post, etc.). Anything tagged
        // [data-preserve-draft] with an id gets its value put back, and focus
        // restored if it was active before the render.
        html.find('[data-preserve-draft]').each((_, el) => {
            if (!el.id) return;
            const draft = this._composerDrafts[el.id];
            if (draft !== undefined && draft !== "") el.value = draft;
            if (this._composerFocusId === el.id) {
                try { el.focus(); } catch (e) {}
                if (typeof el.value === 'string' && typeof el.setSelectionRange === 'function') {
                    const len = el.value.length;
                    try { el.setSelectionRange(len, len); } catch (e) {}
                }
            }
        });

        // --- HANDSET MOBILITY ---
        // Custom drag implementation. V12's global Draggable wasn't reliably
        // driving the V1 window for this app, so we own the lifecycle directly.
        this._setupWindowDrag(html);

        this._setupMapPanning(html);
    }

    /**
     * Lifecycle: clean up all global listeners and timers when the app closes.
     * Prevents leaking $(window) handlers, typing timers, and boot timers across opens.
     */
    async close(options = {}) {
        // Stop any in-flight typing emission
        this._emitTypingStop?.();
        clearTimeout(this._typingStopTimer);
        clearTimeout(this._typingExpireTimer);
        clearTimeout(this.bootTimer);
        clearTimeout(this._storeSearchDebounce);
        this._storeSearchDebounce = null;
        this.bootTimer = null;
        // Patch3 (Ryouhi): tear down call animation if it was running.
        // _wasOpen reset here so the next open re-triggers the start hook in _render.
        this._wasOpen = false;
        try { await this._stopHolophoneCallAnim?.(); } catch (e) {}

        // Detach window-level map panning listeners (namespaced)
        $(window).off('.agentMap');
        if (this._onWindowMouseMove) window.removeEventListener('mousemove', this._onWindowMouseMove);
        if (this._onWindowMouseUp)   window.removeEventListener('mouseup',   this._onWindowMouseUp);
        this._onWindowMouseMove = null;
        this._onWindowMouseUp = null;
        this._windowEventsBound = false;

        // Window-drag listeners (1.8.1: pointer events — mouse + touch)
        if (this._onWindowDragMove) window.removeEventListener('pointermove', this._onWindowDragMove);
        if (this._onWindowDragUp) {
            window.removeEventListener('pointerup', this._onWindowDragUp);
            window.removeEventListener('pointercancel', this._onWindowDragUp);
        }
        this._onWindowDragMove = null;
        this._onWindowDragUp = null;
        this._dragState = { isDragging: false, startX: 0, startY: 0, origX: 0, origY: 0 };
        this._panState = { isPanning: false, startX: 0, startY: 0 };

        // Reset transient UI flags so re-opens start clean
        this.currentView = "boot";
        this.activeContactId = null;
        this.activeShardId = null;
        this.showPayoutModal = false;
        this.showLedgerModal = false;
        this.showShardModal = false;
        this.showEmojiPicker = false;
        this.showAddContact = false;
        this.showIdEditModal = false;
        this.showPayAllModal = false;
        this.showNpcBidModal = false;
        this._pendingNpcBid = null;
        this._pendingConfirm = null;
        // Patch4.7 cleanup so re-opens start fresh.
        this._repEditingId = null;
        this._socialFilter = "all";
        this._storePriceTier = "all";
        // Patch4.8 cleanup
        this.showNewGroup = false;
        this._emojiCategory = "react";
        this.showAttachPicker = false;
        this._attachKind = "photo";
        // Patch4.8.3 cleanup — GM per-thread voice map.
        this._gmSpeakingAsInThread = {};
        this._chatInputDraft = "";
        this._chatInputHadFocus = false;
        this._composerDrafts = {};
        this._composerFocusId = null;

        return super.close(options);
    }

    /**
     * Patch3 (Ryouhi request): optional Sequencer/JB2A/Tagger calling animation.
     * Direct port of EskieMoh's holophone macro — all five effect layers
     * (phone icon, red ring, "CALL" label, two eye-glints) plus the random
     * symbol scroll loop. Toggled by the GM via the `enableCallAnimation`
     * world setting. Silently no-ops if the setting is off or any of the
     * three supporting modules isn't present.
     */
    _holophoneEnabled() {
        try {
            if (!game.settings.get("VirtualAgent", "enableCallAnimation")) return false;
        } catch (e) { return false; }
        // Patch4 round 5: Tagger is no longer required (we use a local Set
        // for animation state instead of writing token flags). Only Sequencer
        // is needed for the actual VFX playback.
        return !!(globalThis.Sequencer && typeof globalThis.Sequence === "function");
    }

    _holophoneToken() {
        // Resolution order: currently-controlled token → assigned-character's
        // token on the active scene → single owned token on the active scene.
        // Patch3 round 2: players rarely have their token selected when they
        // pop open the phone, so we fall back to assigned-character lookup.
        const c = canvas?.tokens?.controlled?.[0];
        if (c) return c;
        const charId = game.user?.character?.id;
        if (charId && canvas?.tokens?.placeables) {
            const byChar = canvas.tokens.placeables.find(t => t.actor?.id === charId);
            if (byChar) return byChar;
        }
        const owned = canvas?.tokens?.placeables?.filter(t => t.actor?.isOwner) || [];
        return owned.length === 1 ? owned[0] : null;
    }

    async _playHolophoneCallAnim() {
        // Patch3.2 round 2 (sync fix): instead of running the animation locally
        // and relying on Sequencer's auto-broadcast (which fails when the
        // originator and other clients have different JB2A versions installed,
        // and throttles under our rapid-fire text loop), we emit a socket event
        // and EVERY client (including this one) runs its own local copy. Each
        // client probes its own asset availability and renders accordingly.
        if (!this._holophoneEnabled()) return;
        const tok = this._holophoneToken();
        if (!tok) {
            console.log("[Virtual Agent] Holophone animation: no token to attach to (select your token or assign a character).");
            return;
        }
        // Remember the token so close() knows which one to clean up.
        this._callAnimTokenId = tok.id;
        // Tell every client (including us) to start their own local animation.
        try {
            game.socket.emit("module.VirtualAgent", {
                action: "holophoneStart",
                tokenId: tok.id,
                sceneId: canvas?.scene?.id || null
            });
        } catch (e) { console.warn("[Virtual Agent] holophoneStart emit failed:", e); }
        // And kick it off locally right now (socket.emit doesn't loop back to sender).
        try { await this._runHolophoneCallAnimLocal(tok.id); } catch (e) { console.warn("[Virtual Agent] local holophone start failed:", e); }
    }

    /**
     * Actual VFX runner — called locally on every connected client via socket.
     * Uses the local Sequencer/JB2A install for asset probing, so each client
     * renders with whatever they have available (no cross-client asset drift).
     */
    async _runHolophoneCallAnimLocal(tokenId) {
        if (!this._holophoneEnabled()) return;
        const tok = canvas?.tokens?.get?.(tokenId);
        if (!tok) {
            // Token not on this client's canvas — silent skip. This is normal
            // for clients viewing a different scene than the originator.
            return;
        }
        try {
            // Patch4 round 5 (Gotto Goho's spam bug): we used to call
            //   Tagger.addTags(tok, "AgentCalling")
            // on every client to mark "this token is currently calling". Tagger
            // persists the tag as a token flag, which means every NON-OWNER
            // client that received the holophoneStart socket message was trying
            // to update someone else's token — Foundry blocked the write and
            // spammed "User X lacks permission to update Token Y" toasts on
            // every client when any phone opened.
            // Fix: track per-client animation state in a local Map keyed by
            // token id. No more flag writes, no more permission spam.
            globalThis.__AgentDeviceCalling = globalThis.__AgentDeviceCalling || new Set();
            if (globalThis.__AgentDeviceCalling.has(tok.id)) return; // already running locally
            globalThis.__AgentDeviceCalling.add(tok.id);

            const style = {
                fill: "white", fontFamily: "Impact", fontSize: 10,
                dropShadow: true, dropShadowAlpha: 0.5, dropShadowBlur: 5, dropShadowDistance: 3
            };
            const textstyle = {
                fill: "#00FCD0", fontFamily: "Impact", fontSize: 6,
                dropShadow: true, dropShadowAlpha: 0.5, dropShadowBlur: 5, dropShadowDistance: 3
            };

            // Patch3.2 (Ryouhi error report): the user hit
            //   "Sequencer | Effect | Play - Could not find file: jb2a.token_stage.round.red.01.05"
            // because that specific token_stage variant ships with JB2A Patreon, not the
            // Free pack. Check each entry against Sequencer.Database before adding it;
            // pick a fallback ring asset that exists in JB2A Free if the Patreon one is
            // missing, so the animation degrades gracefully instead of erroring out.
            const _hasFile = (p) => {
                try { return !!globalThis.Sequencer?.Database?.entryExists?.(p); }
                catch (e) { return true; } // older Sequencer — assume yes, let Sequencer surface its own error
            };
            const _firstAvailable = (...candidates) => candidates.find(_hasFile) || null;

            // Ring asset: prefer the Patreon round.red, fall back through Free options.
            const ringFile = _firstAvailable(
                "jb2a.token_stage.round.red.01.05",
                "jb2a.token_border_circle.static.red.011",
                "jb2a.markers.circle_of_stars.red",
                "jb2a.energy_field.02.below.red"
            );
            // Eye-glint asset
            const glintFile = _firstAvailable(
                "jb2a.twinkling_stars.points04.orange",
                "jb2a.twinkling_stars.points02.orange",
                "jb2a.twinkling_stars.points06.orange"
            );

            // Build the sequence conditionally so a missing optional layer doesn't
            // throw "Could not find file:" toasts.
            // Patch3.2 round 2: every effect is `.locally(true)` because we're
            // running this sequence on EVERY client via socket — if Sequencer
            // also auto-broadcast it we'd get N×N effect spam across the network.
            const seq = new globalThis.Sequence();

            // Layer 1 — phone icon (imgur, always available unless network blocked)
            seq.effect()
                .file("https://i.imgur.com/Vif3lSd.png")
                .name("AgentCall")
                .atLocation(tok)
                .locally(true)
                .scaleIn({ x: 0.75, y: 0 }, 50)
                .scaleOut({ x: 0.75, y: 0 }, 50)
                .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: -0.18, y: 0.18 }, gridUnits: true, bindRotation: false })
                .size(0.47, { gridUnits: true })
                .aboveLighting()
                .persist()
                .zIndex(0);

            // Layer 2 — red ring (JB2A, may be Patreon-only — try fallbacks)
            if (ringFile) {
                seq.effect()
                    .file(ringFile)
                    .name("AgentCall")
                    .atLocation(tok)
                    .locally(true)
                    .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: -0.2, y: 0.2 }, gridUnits: true, bindRotation: false })
                    .size(0.5, { gridUnits: true })
                    .aboveLighting()
                    .persist()
                    .zIndex(1);
            } else {
                console.log("[Virtual Agent] Holophone: no compatible JB2A ring asset found — skipping ring layer.");
            }

            // Layer 3 — "CALL" text label (always works, Sequencer renders text natively)
            seq.effect()
                .text("CALL", style)
                .name("AgentCall")
                .atLocation(tok)
                .locally(true)
                .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: 0.057, y: -0.025 }, gridUnits: true, bindRotation: false })
                .size(0.015, { gridUnits: true })
                .aboveLighting()
                .persist()
                .zIndex(2);

            // Layers 4 & 5 — eye glints (JB2A)
            if (glintFile) {
                seq.effect()
                    .file(glintFile)
                    .name("AgentCall")
                    .atLocation(tok, { offset: { x: -0.2, y: -0.16 }, gridUnits: true, local: true })
                    .locally(true)
                    .size({ width: 0.4, height: 0.1 }, { gridUnits: true })
                    .aboveLighting()
                    .persist()
                    .zIndex(0)
                    .filter("ColorMatrix", { hue: 25 })
                    .filter("Blur", { blurX: 30, blurY: 0 })
                    .playbackRate(5)
                    .attachTo(tok);
                seq.effect()
                    .file(glintFile)
                    .name("AgentCall")
                    .atLocation(tok, { offset: { x: 0.12, y: -0.225 }, gridUnits: true, local: true })
                    .locally(true)
                    .size({ width: 0.4, height: 0.1 }, { gridUnits: true })
                    .aboveLighting()
                    .persist()
                    .zIndex(0)
                    .filter("ColorMatrix", { hue: 25 })
                    .filter("Blur", { blurX: 30, blurY: 0 })
                    .playbackRate(5)
                    .attachTo(tok);
            } else {
                console.log("[Virtual Agent] Holophone: no compatible JB2A twinkling_stars asset found — skipping eye-glints.");
            }

            await seq.play();

            await globalThis.Sequencer.Helpers.wait(750);

            // Symbol-scroll loop — keep firing CallText effects while the tag
            // is present. Tag removal (in _stopHolophoneCallAnim) exits the loop.
            const symbols = ['⍰','⍱','⍲','⍽','⍾','⍿','░','▒','▓','≡','║','⎀','⎃','⎅','⎆','⎉','⌷','⌸','⌹','⌻','⌼','⌽','☰','☱','☲','☳','☴','☵','☶','☷','⣹','⣺','⣻','⣼','⣽','⣾','⣿'];
            let i = 1, e = 1, safety = 0;
            this._callAnimToken = tok;
            // Patch3.2 round 2: the original macro fires ~100 effects/sec which
            // overwhelms Sequencer's socket when broadcast. Now that every client
            // runs its own local loop (we explicitly .locally(true) below) the
            // network isn't the bottleneck — but the visual cascade is the same
            // at ~5 chars/sec, so we slow the loop to 200ms.
            const LOOP_INTERVAL_MS = 200;
            // Safety cap: ~30 min worth of iterations at this rate.
            const MAX_ITER = (30 * 60 * 1000) / LOOP_INTERVAL_MS;
            while (globalThis.__AgentDeviceCalling?.has(tok.id) && safety++ < MAX_ITER) {
                if (i === 12 || i === 24) e = 1;
                if (i > 36) {
                    i = 1; e = 1;
                    await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
                }
                const word = globalThis.Sequencer.Helpers.random_array_element(symbols, false);
                await new globalThis.Sequence()
                    .wait(LOOP_INTERVAL_MS)
                    .effect()
                        .text(`${word}`, textstyle)
                        .name("AgentCallText")
                        .atLocation(tok)
                        .locally(true)
                        .attachTo(tok, { align: "top-right", edge: "outer", bindVisibility: false, offset: { x: 0.3 + (e * 0.075), y: -0.21 + (Math.floor(i / 12) * 0.13) }, gridUnits: true, bindRotation: false })
                        .size(0.015, { gridUnits: true })
                        .aboveLighting()
                        .duration(10000)
                        .zIndex(2)
                    .play();
                i++;
                e++;
            }
        } catch (err) {
            console.warn("[Virtual Agent] Holophone animation failed:", err);
            // Defensive cleanup so we don't leave the tag stuck on the token.
            try { await globalThis.Tagger?.removeTags?.(tok, "AgentCalling"); } catch (_) {}
        }
    }

    async _stopHolophoneCallAnim() {
        // Patch3.2 round 2: broadcast stop to every client (like start).
        const tokenId = this._callAnimTokenId || this._callAnimToken?.id;
        try {
            game.socket.emit("module.VirtualAgent", { action: "holophoneStop", tokenId });
        } catch (e) { console.warn("[Virtual Agent] holophoneStop emit failed:", e); }
        // And do the local cleanup ourselves (emit doesn't loop back).
        try { await this._runHolophoneCallAnimStopLocal(tokenId); } catch (e) {}
        this._callAnimToken = null;
        this._callAnimTokenId = null;
    }

    async _runHolophoneCallAnimStopLocal(tokenId) {
        // Patch4 round 5: stop uses the local Set, not Tagger flags. Setting
        // the bit to false makes the while-loop exit on its next iteration,
        // and the EffectManager calls clean up the visible persisted effects.
        if (!globalThis.Sequencer) return;
        const tok = tokenId ? canvas?.tokens?.get?.(tokenId) : null;
        if (!tok) {
            // Still drop our local state flag even if the token isn't on this
            // canvas — keeps the Set tidy across scene changes.
            if (tokenId) globalThis.__AgentDeviceCalling?.delete?.(tokenId);
            return;
        }
        globalThis.__AgentDeviceCalling?.delete?.(tok.id);
        try {
            await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCall", object: tok });
            await globalThis.Sequencer.EffectManager.endEffects({ name: "AgentCallText", object: tok });
        } catch (e) {
            console.warn("[Virtual Agent] Holophone local cleanup failed:", e);
        }
    }

    /* ---------- Realistic-texting helpers ---------- */

    async _render(force, options) {
        if (this.element && this.element.length) {
            const cw = this.element.find('.chat-window');
            if (cw.length) {
                const el = cw[0];
                const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
                this._chatNearBottom = dist < 80;
            }
            const ta = this.element.find('#agent-chat-input');
            if (ta.length) {
                this._chatInputDraft = ta.val() || "";
                // Patch5.0.2 (Ryouhi/Pop Out!): read activeElement from the
                // element's owning document so popped-out windows work.
                this._chatInputHadFocus = (ta[0].ownerDocument?.activeElement === ta[0]);
            }
            // Capture generic composer drafts (Social post, future inline composers).
            // Any input/textarea/select tagged with [data-preserve-draft] is preserved
            // across renders so cross-client re-renders don't wipe in-progress text.
            // Patch3: if the user navigated to a different view (or sub-view like
            // a different auction), drop the previous view's drafts so old values
            // don't leak into freshly-rendered inputs that share an id.
            const _viewKey = `${this.currentView}|${this.activeContactId || ''}|${this._auctionDetailId || ''}`;
            if (this._composerDraftsView !== _viewKey) {
                this._composerDrafts = {};
                this._composerDraftsView = _viewKey;
                // Patch3.3: scroll positions are scoped to a view too, so a
                // stale position from Sys Admin doesn't get applied to Fixers etc.
                this._scrollPositions = {};
            }
            this._composerFocusId = null;
            // Patch5.0.2 (Ryouhi/Pop Out!): pull activeElement from the agent's
            // owning document so the popped-out window's focused element is
            // detected correctly. `this.element[0]?.ownerDocument` is the
            // popout window's document when popped out, the main page's
            // document otherwise.
            const active = this.element[0]?.ownerDocument?.activeElement || null;
            this.element.find('[data-preserve-draft]').each((_, el) => {
                if (!el.id) return;
                this._composerDrafts[el.id] = (typeof el.value === 'string') ? el.value : '';
                if (active === el) this._composerFocusId = el.id;
            });

            // Patch3.3: capture scroll positions of long scroll containers so
            // toggling items in Sys Admin (or other render(true) triggers) doesn't
            // jump back to the top. Keyed by class for stability across re-renders.
            this._scrollPositions = this._scrollPositions || {};
            const _scrollSelectors = ['.admin-console', '.rep-view', '.style-view', '.contact-list', '.feed-list', '.transaction-list'];
            for (const sel of _scrollSelectors) {
                const el = this.element.find(sel)[0];
                if (el && el.scrollTop > 0) this._scrollPositions[sel] = el.scrollTop;
            }
            // Patch5.5.7: self-discovering scroll preservation. Any element with
            // `data-preserve-scroll-container="<key>"` has its scrollTop captured
            // before render and restored after. Lets new app views opt in by
            // adding the attribute, no JS array maintenance. Used by the 5.5
            // app views (NCPD / Ziggurat / Garden) so category clicks and list
            // scrolling don't snap back to the top.
            this.element.find('[data-preserve-scroll-container]').each((_, el) => {
                const key = el.getAttribute('data-preserve-scroll-container');
                if (key && el.scrollTop > 0) {
                    this._scrollPositions[`[data-preserve-scroll-container="${key}"]`] = el.scrollTop;
                }
            });
        }
        // Patch3 round 2 (Ryouhi): fire the holophone call animation reliably on
        // every open. We do this AFTER super._render so the app's DOM is in place
        // and `this.rendered` flips true. _wasOpen tracks closed→open transitions
        // so the animation only fires when the app actually appears, not on the
        // many in-place re-renders that happen during normal use.
        const _prevOpen = this._wasOpen;
        const _ret = await super._render(force, options);
        if (this.rendered && !_prevOpen) {
            this._wasOpen = true;
            // Defer slightly so canvas + token state is settled.
            setTimeout(() => {
                try { this._playHolophoneCallAnim?.(); } catch (e) { console.warn("[Virtual Agent] holophone start error:", e); }
            }, 200);
        }
        return _ret;
    }

    _autoGrowInput(el) {
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 120) + 'px';
    }

    _emitTyping() {
        if (!this.activeContactId) return;
        // Patch5.0.1 (Gotto): typing indicator was always sending the GM's
        // name and token even when speaking as an NPC — recipients saw
        // "Gamemaster is writing" + the generic GM avatar. Mirror the same
        // persona resolution the message-send path uses so the indicator
        // matches what the message will actually look like.
        let fromName = game.user.name;
        let fromAvatar = "";
        if (game.user.isGM) {
            const contacts = this._getContacts();
            const threadContact = contacts.find(c => c.id === this.activeContactId);
            const isNpcThread = this.activeContactId?.startsWith("npc_");
            if (isNpcThread && threadContact) {
                fromName = threadContact.originalName || threadContact.name;
                fromAvatar = threadContact.avatar || "";
            } else if (threadContact?.isCustomGroup && this._gmSpeakingAsInThread) {
                const cur = this._gmSpeakingAsInThread[this.activeContactId];
                if (cur && cur !== "gm") {
                    // Lookup the NPC contact across all user lists.
                    for (const u of game.users) {
                        const lst = u.getFlag("VirtualAgent", "customContacts") || [];
                        const match = lst.find(c => c.id === cur);
                        if (match) {
                            fromName = match.originalName || match.name;
                            fromAvatar = match.avatar || "";
                            break;
                        }
                    }
                }
            }
        }
        if (!this._typingEmitting) {
            this._typingEmitting = true;
            game.socket.emit("module.VirtualAgent", {
                action: "agentTyping",
                threadId: this.activeContactId,
                fromUserId: game.user.id,
                fromName,
                fromAvatar
            });
        }
        clearTimeout(this._typingStopTimer);
        this._typingStopTimer = setTimeout(() => this._emitTypingStop(), 2500);
    }

    _emitTypingStop() {
        clearTimeout(this._typingStopTimer);
        if (!this._typingEmitting) return;
        this._typingEmitting = false;
        game.socket.emit("module.VirtualAgent", {
            action: "agentTypingStop",
            threadId: this.activeContactId,
            fromUserId: game.user.id
        });
    }

    _handleTypingEvent(data, isStop) {
        if (!data || data.fromUserId === game.user.id) return;
        if (isStop) {
            delete this.typingPeers[data.fromUserId];
        } else {
            const user = game.users.get(data.fromUserId);
            // Patch5.0.1: prefer the persona name+avatar the sender computed
            // (NPC voice or NPC-thread override). Falls back to the sender's
            // user profile if no override was carried on the event.
            const displayName = data.fromName || user?.name || "Someone";
            const displayAvatar = data.fromAvatar
                || user?.character?.img
                || user?.avatar
                || "icons/svg/mystery-man.svg";
            this.typingPeers[data.fromUserId] = {
                userId: data.fromUserId,
                threadId: data.threadId,
                name: displayName,
                avatar: displayAvatar,
                expiresAt: Date.now() + 3500
            };
            clearTimeout(this._typingExpireTimer);
            this._typingExpireTimer = setTimeout(() => {
                this._cleanupTypingPeers();
            }, 3600);
        }
        if (this.rendered && this.currentView === 'chat-thread') this.render(false);
    }

    _cleanupTypingPeers() {
        const now = Date.now();
        let changed = false;
        for (const k of Object.keys(this.typingPeers)) {
            if (this.typingPeers[k].expiresAt <= now) { delete this.typingPeers[k]; changed = true; }
        }
        if (changed && this.rendered && this.currentView === 'chat-thread') this.render(false);
    }

    _currentTypingPeer() {
        const now = Date.now();
        for (const k of Object.keys(this.typingPeers)) {
            const p = this.typingPeers[k];
            if (p.expiresAt <= now) continue;
            // 5.8.43: a DM typing event carries threadId = the RECIPIENT's user id, so the
            // bare `activeContactId === p.threadId` match leaked "X is typing" into any third
            // party who had a DM open with that recipient. Shared threads (NPC/group) still
            // match by threadId for all participants; a 1-to-1 DM only shows to the intended
            // recipient (game.user.id === p.threadId) while they view the sender's thread.
            const isSharedThread = typeof p.threadId === 'string' &&
                (p.threadId.startsWith('npc_') || p.threadId.startsWith('pcgroup_') || p.threadId === 'party_group_chat');
            if (isSharedThread) {
                if (this.activeContactId === p.threadId) return p;
            } else if (game.user.id === p.threadId && this.activeContactId === p.userId) {
                return p;
            }
        }
        return null;
    }

    /**
     * Scroll-by-drag for internal lists. Listeners are bound on the element
     * (not window), so they die naturally when the element is re-rendered.
     */
    _setupScrollDrag(el) {
        if (!el.length) return;
        const target = el[0];
        let isDown = false, startY, scrollTop;
        // Patch4 round 6 (kieraboom bug): jQuery handlers were bound with
        // `.on(...)` only, never `.off(...)`. On most renders this didn't
        // matter because the DOM element was fresh, but if Foundry happened
        // to re-use the same node across a partial render (or if a stray
        // re-render fired during an existing pan) the handlers stacked.
        // After enough stacks, the cumulative `mousemove` handlers chewed
        // input and made the device feel like it was "clicking on its own"
        // and stealing focus from fields. Namespace + off-before-on defeats
        // that completely.
        el.off('.agentScrollDrag');
        el.on('mousedown.agentScrollDrag', (e) => { isDown = true; startY = e.pageY - target.offsetTop; scrollTop = target.scrollTop; });
        el.on('mouseleave.agentScrollDrag', () => isDown = false);
        el.on('mouseup.agentScrollDrag', () => isDown = false);
        el.on('mousemove.agentScrollDrag', (e) => {
            if (!isDown) return;
            e.preventDefault();
            const y = e.pageY - target.offsetTop;
            const walk = (y - startY) * 2;
            target.scrollTop = scrollTop - walk;
        });
    }

    /**
     * Map panning: bind window mousemove/mouseup ONCE per app instance.
     * Cleaned up in close(). Prevents the stacked-listener bug on re-render.
     */
    _setupMapPanning(html) {
        const viewport = html.find('.map-viewport');
        const container = html.find('.map-container');
        if (!viewport.length || !container.length) return;

        // ----- Element-scoped listeners (rebind each render is fine; they die with the element) -----

        viewport.off('mousedown.agentMap').on('mousedown.agentMap', (e) => {
            // Don't start a pan if the user is clicking the zoom buttons
            if ($(e.target).closest('.map-controls').length) return;
            // Patch5.5.14: in pin-placement mode, skip pan entirely — the cursor
            // should stay crosshair and clicks go straight to the pin handler.
            if (this._mapPinMode) return;
            e.preventDefault();
            this._panState.isPanning = true;
            this._panState.moved = false;
            this._panState.startX = e.pageX - (this.mapX || 0);
            this._panState.startY = e.pageY - (this.mapY || 0);
            container.css('cursor', 'grabbing');
        });

        viewport.off('wheel.agentMap').on('wheel.agentMap', (e) => {
            const native = e.originalEvent || e;
            // Only intercept when the map view is visible
            if (this.currentView !== 'map') return;
            native.preventDefault?.();
            e.preventDefault();
            const delta = native.deltaY ?? 0;
            const factor = delta < 0 ? 1.1 : 1 / 1.1;
            this.mapZoom = Math.min(Math.max((this.mapZoom || 1) * factor, 0.4), 4);
            container.css('transform',
                `translate(-50%, -50%) translate(${this.mapX}px, ${this.mapY}px) scale(${this.mapZoom})`);
        });

        // Patch5.5.20: pure-JS hover control for pin labels. CSS-only kept failing
        // (specificity / Foundry cache / something), so this owns the inline opacity
        // directly. On bind: read data-label-mode, hide labels of hover-only pins.
        // On mouseenter: show the label. On mouseleave: hide it. No CSS dependency.
        const mapPins = html.find('.agent-map-pin');
        mapPins.each(function() {
            const mode = this.dataset.labelMode || 'always';
            const label = this.querySelector('.pin-label');
            if (!label) return;
            if (mode === 'hover') {
                label.style.opacity = '0';
            } else {
                label.style.opacity = '1';
            }
        });
        mapPins.off('mouseenter.agentPinHover mouseleave.agentPinHover')
            .on('mouseenter.agentPinHover', function() {
                if ((this.dataset.labelMode || 'always') !== 'hover') return;
                const lbl = this.querySelector('.pin-label');
                if (lbl) lbl.style.opacity = '1';
            })
            .on('mouseleave.agentPinHover', function() {
                if ((this.dataset.labelMode || 'always') !== 'hover') return;
                const lbl = this.querySelector('.pin-label');
                if (lbl) lbl.style.opacity = '0';
            });

        // Patch5.5.3: click-to-place pin handler. Only active when the GM has
        // pin mode on. The user did the math complaint ("GMs don't know x and y")
        // — now the GM just clicks where the pin should go and a modal opens
        // with the click position pre-filled. Coordinates are stored as %
        // of the map image so they survive zoom + pan + map-image swaps.
        // Patch5.5.17: bind click on .map-container instead of .agent-map-img.
        // The img element has pointer-events:none baked into its style (so the
        // browser's default drag-an-image behavior doesn't interfere with pan
        // gestures). Only the container catches clicks. The img's bounding rect
        // is still resolvable for coord math even when pointer-events is none —
        // getBoundingClientRect works regardless. We resolve the img inside the
        // handler instead of relying on e.currentTarget being the img.
        const mapContainer = html.find('.map-container');
        mapContainer.off('click.agentPin').on('click.agentPin', (e) => {
            if (!game.user.isGM) return;
            if (!this._mapPinMode) return;
            if (this._panState?.isPanning) return;
            // Audit catch (5.5.4): browsers fire `click` on mouseup, and mouseup
            // resets isPanning to false before click runs. Without this guard,
            // a drag-pan would pop a phantom pin modal at the release point.
            if (this._panState?.moved) { this._panState.moved = false; return; }
            // Don't fire on clicks that bubble up from the zoom buttons / pin
            // controls / placed pins. Only the bare map should drop a pin.
            if ($(e.target).closest('.map-controls, .agent-map-pin').length) return;
            const img = mapContainer.find('.agent-map-img')[0];
            if (!img) return;
            e.preventDefault();
            e.stopPropagation();
            const rect = img.getBoundingClientRect();
            const x = ((e.clientX - rect.left) / rect.width) * 100;
            const y = ((e.clientY - rect.top) / rect.height) * 100;
            // If the click landed outside the image (in the viewport padding),
            // skip — don't drop a pin off the map.
            if (x < 0 || x > 100 || y < 0 || y > 100) return;
            this._pendingPinX = Math.max(0, Math.min(100, x));
            this._pendingPinY = Math.max(0, Math.min(100, y));
            this.showMapPinModal = true;
            this.render(true);
        });

        // ----- Window-level listeners (bind ONCE per instance, detach in close()) -----

        if (this._windowEventsBound) return;
        this._windowEventsBound = true;

        this._onWindowMouseMove = (e) => {
            if (!this._panState?.isPanning) return;
            this._panState.moved = true;
            this.mapX = e.pageX - this._panState.startX;
            this.mapY = e.pageY - this._panState.startY;
            const liveContainer = this.element?.find?.('.map-container');
            if (liveContainer?.length) {
                liveContainer.css('transform',
                    `translate(-50%, -50%) translate(${this.mapX}px, ${this.mapY}px) scale(${this.mapZoom})`);
            }
        };
        this._onWindowMouseUp = () => {
            if (this._panState?.isPanning) {
                this._panState.isPanning = false;
                const liveContainer = this.element?.find?.('.map-container');
                if (liveContainer?.length) liveContainer.css('cursor', this._mapPinMode ? 'crosshair' : 'grab');
            }
        };
        window.addEventListener('mousemove', this._onWindowMouseMove);
        window.addEventListener('mouseup',   this._onWindowMouseUp);
    }

    /**
     * Custom window drag implementation. Binds mousedown on the top-bar
     * .drag-handle; window mousemove/mouseup are bound ONCE per instance and
     * detached in close(). State lives on this._dragState so handlers always
     * see the latest mousedown values.
     */
    _setupWindowDrag(html) {
        // NuNu packaging: bind every .drag-handle, not just the first, so the bottom bezel drags too.
        const handle = html.find('.drag-handle');
        if (!handle.length) return;

        // The actual window element (the app frame Foundry wraps around our template).
        const appEl = this.element?.[0] || handle.closest('.app')[0] || html.closest('.app')[0];
        if (!appEl) return;

        // Per-render: rebind on the handle (element-scoped, dies with re-render).
        // 1.8.1 — pointerdown (mouse + touch): phone players couldn't drag the Agent at all.
        handle.off('mousedown.agentDrag pointerdown.agentDrag').on('pointerdown.agentDrag', (e) => {
            // Ignore drags that start on the close button or any data-action element
            if ($(e.target).closest('.agent-close-btn, [data-action]').length) return;
            e.preventDefault();
            const rect = appEl.getBoundingClientRect();
            this._dragState.isDragging = true;
            this._dragState.startX = e.clientX;
            this._dragState.startY = e.clientY;
            this._dragState.origX = rect.left;
            this._dragState.origY = rect.top;
            handle.css('cursor', 'grabbing');
        });

        // Once per instance: global mousemove/up. Cleaned up in close().
        if (this._onWindowDragMove) return;

        this._onWindowDragMove = (e) => {
            if (!this._dragState?.isDragging) return;
            const nx = this._dragState.origX + (e.clientX - this._dragState.startX);
            const ny = this._dragState.origY + (e.clientY - this._dragState.startY);
            // Use Foundry's positioning API so the app's internal position state stays in sync
            this.setPosition({ left: nx, top: ny });
        };
        this._onWindowDragUp = () => {
            if (this._dragState?.isDragging) {
                this._dragState.isDragging = false;
                this.element?.find?.('.drag-handle').css('cursor', 'move');
            }
        };
        window.addEventListener('pointermove', this._onWindowDragMove);
        window.addEventListener('pointerup',   this._onWindowDragUp);
        window.addEventListener('pointercancel', this._onWindowDragUp);
    }

    /**
     * Lazy-load every priced item from the CPR compendiums. Cached on the
     * instance until close(). Returns a categorized catalog object.
     */
    async _loadStoreCatalog() {
        if (this._storeCatalog) return this._storeCatalog;
        if (this._storeLoading) return this._storeLoading;
        const PACK_TO_CATEGORY = {
            "cyberpunk-red-core.core_weapons":          "Weapons",
            "cyberpunk-red-core.core_weapons-branded":  "Weapons",
            "cyberpunk-red-core.core_ammo":             "Ammo",
            "cyberpunk-red-core.core_armor":            "Armor",
            "cyberpunk-red-core.core_clothing":         "Clothing",
            "cyberpunk-red-core.core_gear":             "Gear",
            "cyberpunk-red-core.core_cyberware":        "Cyberware",
            "cyberpunk-red-core.core_drugs":            "Drugs",
            "cyberpunk-red-core.core_programs":         "Programs",
            "cyberpunk-red-core.core_vehicles":         "Vehicles",
            "cyberpunk-red-core.core_upgrades":         "Upgrades",
            // Black Chrome DLC packs auto-included if present
            "cyberpunk-red-core.black-chrome_weapons":   "Weapons",
            "cyberpunk-red-core.black-chrome_ammo":      "Ammo",
            "cyberpunk-red-core.black-chrome_armor":     "Armor",
            "cyberpunk-red-core.black-chrome_clothing":  "Clothing",
            "cyberpunk-red-core.black-chrome_gear":      "Gear",
            "cyberpunk-red-core.black-chrome_cyberware": "Cyberware",
            "cyberpunk-red-core.black-chrome_vehicles":  "Vehicles",
            "cyberpunk-red-core.black-chrome_upgrades":  "Upgrades"
        };
        this._storeLoading = (async () => {
            const catalog = {};
            for (const [packId, cat] of Object.entries(PACK_TO_CATEGORY)) {
                const pack = game.packs.get(packId);
                if (!pack) continue;
                try {
                    const docs = await pack.getDocuments();
                    for (const d of docs) {
                        const price = foundry.utils.getProperty(d, "system.price.market");
                        if (typeof price !== "number" || price <= 0) continue;
                        catalog[cat] = catalog[cat] || [];
                        catalog[cat].push({
                            uuid: d.uuid,
                            name: d.name,
                            img: d.img || "icons/svg/mystery-man.svg",
                            price: price,
                            type: d.type,
                            isCustom: false
                        });
                    }
                } catch (e) {
                    console.warn(`[Virtual Agent] Store: pack ${packId} load failed`, e);
                }
            }
            // Load custom compendium packs (GM-configured)
            try {
                const customPackStr = game.settings.get("VirtualAgent", "customStorePacks") || "";
                const customPackIds = customPackStr.split(",").map(s => s.trim()).filter(Boolean);
                for (const packId of customPackIds) {
                    const pack = game.packs.get(packId);
                    if (!pack) { console.warn(`[Virtual Agent] Store: custom pack ${packId} not found`); continue; }
                    try {
                        const docs = await pack.getDocuments();
                        // Derive category from pack name or use "Custom"
                        const packLabel = pack.metadata?.label || "Custom";
                        for (const d of docs) {
                            const price = foundry.utils.getProperty(d, "system.price.market");
                            const cat = (typeof price === "number" && price > 0) ? packLabel : null;
                            if (!cat) continue;
                            catalog[cat] = catalog[cat] || [];
                            catalog[cat].push({
                                uuid: d.uuid,
                                name: d.name,
                                img: d.img || "icons/svg/mystery-man.svg",
                                price: price,
                                type: d.type,
                                isCustom: true
                            });
                        }
                    } catch (e) {
                        console.warn(`[Virtual Agent] Store: custom pack ${packId} load failed`, e);
                    }
                }
            } catch (e) { console.warn("[Virtual Agent] Store: custom packs setting not found"); }

            // Merge in manually-added custom items (GM JSON setting)
            try {
                const rawCustom = game.settings.get("VirtualAgent", "customStoreItems") || "[]";
                let customItems = [];
                try { customItems = JSON.parse(rawCustom); } catch (e) {}
                if (Array.isArray(customItems)) {
                    for (const ci of customItems) {
                        if (!ci.name || !ci.category || !ci.price) continue;
                        const cat = ci.category;
                        catalog[cat] = catalog[cat] || [];
                        catalog[cat].push({
                            uuid: "custom_" + btoa(ci.name + "|" + ci.category + "|" + ci.price).replace(/[^a-zA-Z0-9]/g, ''),
                            name: ci.name,
                            img: ci.img || "modules/VirtualAgent/assets/cyberpunk-holophone/icons/optics.png",
                            price: Number(ci.price) || 0,
                            type: ci.type || "item",
                            description: ci.description || "",
                            isCustom: true
                        });
                    }
                }
            } catch (e) { console.warn("[Virtual Agent] Store: custom items setting not found"); }

            // Patch3.2: apply GM controls — max price cap, source filter,
            // locked categories, blacklist. Filters are applied AFTER catalog
            // assembly so cache invalidation just bumps the setting onChange.
            let maxPrice = 0, srcFilter = "all", lockedCats = "", blacklist = "";
            try { maxPrice  = Number(game.settings.get("VirtualAgent", "storeMaxPrice")) || 0; } catch (e) {}
            try { srcFilter = game.settings.get("VirtualAgent", "storeSourceFilter") || "all"; } catch (e) {}
            try { lockedCats = game.settings.get("VirtualAgent", "storeLockedCategories") || ""; } catch (e) {}
            try { blacklist = game.settings.get("VirtualAgent", "storeBlacklistIds") || ""; } catch (e) {}
            const lockedSet = new Set(lockedCats.split(",").map(s => s.trim().toLowerCase()).filter(Boolean));
            const blockedSet = new Set(blacklist.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean));
            for (const cat of Object.keys(catalog)) {
                if (lockedSet.has(cat.toLowerCase())) { delete catalog[cat]; continue; }
                catalog[cat] = catalog[cat].filter(item => {
                    if (maxPrice > 0 && Number(item.price) > maxPrice) return false;
                    if (srcFilter === "core"   && item.isCustom) return false;
                    if (srcFilter === "custom" && !item.isCustom) return false;
                    if (blockedSet.size) {
                        const uuidLc = String(item.uuid || "").toLowerCase();
                        const nameLc = String(item.name || "").toLowerCase();
                        if (blockedSet.has(uuidLc) || blockedSet.has(nameLc)) return false;
                    }
                    return true;
                });
                // Drop now-empty categories so the tab bar doesn't show ghost tabs.
                if (catalog[cat].length === 0) delete catalog[cat];
            }

            // Sort each category alphabetically
            for (const cat of Object.keys(catalog)) {
                catalog[cat].sort((a, b) => a.name.localeCompare(b.name));
            }
            this._storeCatalog = catalog;
            this._storeLoading = null;
            return catalog;
        })();
        return this._storeLoading;
    }

    _getCart() {
        return game.user.getFlag("VirtualAgent", "cart") || [];
    }

    async _addToCart(itemUuid, item) {
        const cart = this._getCart();
        const existing = cart.find(e => e.itemUuid === itemUuid);
        if (existing) {
            existing.qty = (existing.qty || 1) + 1;
        } else {
            cart.push({ itemUuid, name: item.name, img: item.img, price: item.price, type: item.type, qty: 1 });
        }
        await game.user.setFlag("VirtualAgent", "cart", cart);
    }

    async _setCartQty(itemUuid, qty) {
        let cart = this._getCart();
        if (qty <= 0) {
            cart = cart.filter(e => e.itemUuid !== itemUuid);
        } else {
            const e = cart.find(e => e.itemUuid === itemUuid);
            if (e) e.qty = qty;
        }
        await game.user.setFlag("VirtualAgent", "cart", cart);
    }

    async _clearCart() {
        await game.user.setFlag("VirtualAgent", "cart", []);
    }

    _cartTotal(cart) {
        return (cart || this._getCart()).reduce((s, e) => s + (Number(e.price) || 0) * (Number(e.qty) || 0), 0);
    }

    /**
     * Run a NUNU MART checkout. Validates balance + permission, deducts wealth
     * via deltaLedgerProperty, and adds the items to the actor's inventory.
     * Players without OWNER on the target actor route via socket to the GM.
     */
    async _checkout() {
        const cart = this._getCart();
        if (!cart.length) { ui.notifications.warn("Agent Store: Cart is empty."); return; }
        const total = this._cartTotal(cart);
        const actor = this._resolveActor(this.actorUuid);
        if (!(actor instanceof Actor)) {
            ui.notifications.error("Agent Store: No character sheet to deliver to.");
            return;
        }
        const balance = this._getActorEurobucks(actor).balance;
        if (balance < total) {
            ui.notifications.warn(`Agent Store: Insufficient funds. ${total - balance}eb short.`);
            return;
        }
        const canWriteLocally = game.user.isGM || actor.testUserPermission(game.user, "OWNER");
        if (canWriteLocally) {
            await this._processCheckout(actor, cart, total, game.user.name);
        } else {
            if (!game.users.some(u => u.isGM && u.active)) {
                ui.notifications.error("Agent Store: No System Admin online to process order.");
                return;
            }
            console.log("[Virtual Agent] Emitting storeCheckout:", { actorUuid: actor.uuid, total, cart });
            game.socket.emit("module.VirtualAgent", {
                action: "storeCheckout",
                actorUuid: actor.uuid,
                cart, total,
                requesterId: game.user.id
            });
            ui.notifications.info("Agent Store: Order transmitted to System Admin...");
        }
        this.render(true);
    }

    async _processCheckout(actor, cart, total, requesterName) {
        // Deduct wealth via CPR ledger
        if (typeof actor.deltaLedgerProperty === "function") {
            await actor.deltaLedgerProperty("wealth", -total, `Agent: NUNU MART order (${cart.length} item${cart.length===1?'':'s'})`);
        } else {
            const ebPath = this._getActorEurobucks(actor).path;
            await actor.update({ [ebPath]: Math.max(0, this._getActorEurobucks(actor).balance - total) });
        }
        // Expand cart into individual item docs (respecting qty)
        const itemDocs = [];
        let customItemCount = 0;
        for (const entry of cart) {
            for (let i = 0; i < entry.qty; i++) {
                // Custom items have synthetic UUIDs — create a basic item directly
                if (entry.itemUuid && entry.itemUuid.startsWith("custom_")) {
                    itemDocs.push({
                        name: entry.name || "Custom Item",
                        type: entry.type || "gear",
                        img: entry.img || "icons/svg/mystery-man.svg",
                        system: { description: { value: entry.description || `Purchased from NUNU MART for ${entry.price}eb.` } }
                    });
                    customItemCount++;
                    continue;
                }
                try {
                    const item = await fromUuid(entry.itemUuid);
                    if (item) itemDocs.push(item.toObject());
                } catch (e) {
                    console.warn("[Virtual Agent] Store: could not resolve", entry.itemUuid, e);
                }
            }
        }
        if (itemDocs.length) {
            try { await actor.createEmbeddedDocuments("Item", itemDocs); }
            catch (e) { console.warn("[Virtual Agent] Store: createEmbeddedDocuments failed", e); }
        }
        await this._clearCart();
        ui.notifications.info(`Agent Store: Delivered ${itemDocs.length} item${itemDocs.length===1?'':'s'} (${total}eb).`);

        // Receipt chat (whispered to actor owners + GMs)
        const owners = game.users.filter(u => actor.testUserPermission(u, "OWNER")).map(u => u.id);
        const gms = game.users.filter(u => u.isGM).map(u => u.id);
        const whisper = Array.from(new Set([...owners, ...gms]));
        ChatMessage.create({
            content: `<div style="border:1px solid #00ffcc; background:#0a1a1a; padding:10px; font-family:monospace; color:#fff;">
                <b style="color:#00ffcc;">NUNU MART :: ORDER RECEIPT</b><br>
                <span style="color:#888;">CUSTOMER:</span> ${_agentEscHTML(actor.name)}<br>
                <span style="color:#888;">ITEMS:</span> ${Number(itemDocs.length)}<br>
                <span style="color:#888;">TOTAL:</span> ${Number(total)}eb<br>
                ${requesterName ? `<span style="color:#888;">PLACED BY:</span> ${_agentEscHTML(requesterName)}` : ""}
            </div>`,
            whisper,
            flags: { VirtualAgent: { isAgentMessage: false } }
        });
    }

    async _executeTransfer(fromUuid, toUuid, amount, memo) {
        // Patch3: serialize all transfers through a global lock. CPR's
        // `deltaLedgerProperty` is atomic, but VirtualWallet (User flags) and
        // the fallback `actor.update(path, newValue)` path are read-modify-write
        // and can lose balance on concurrent calls. Cheap fix: queue them.
        globalThis.__AgentDeviceXferLock = (globalThis.__AgentDeviceXferLock || Promise.resolve())
            .then(() => this._executeTransferInner(fromUuid, toUuid, amount, memo))
            .catch(err => { console.error("[Virtual Agent] _executeTransfer chain error:", err); return false; });
        return globalThis.__AgentDeviceXferLock;
    }

    async _executeTransferInner(fromUuid, toUuid, amount, memo) {
        if (!game.user.isGM) return false;

        // Hard input validation — must be a finite positive integer
        amount = Number(amount);
        if (!Number.isFinite(amount) || amount <= 0) {
            console.warn("[Virtual Agent] _executeTransfer rejected — invalid amount:", amount);
            return false;
        }
        // Patch3: memo length cap — chat HTML payload safety
        memo = String(memo || "").slice(0, 200);
        if (!fromUuid || !toUuid) {
            console.warn("[Virtual Agent] _executeTransfer rejected — missing uuid:", { fromUuid, toUuid });
            return false;
        }
        if (fromUuid === toUuid) {
            console.warn("[Virtual Agent] _executeTransfer rejected — sender and receiver match");
            return false;
        }

        const resolveTarget = (uuid) => {
            if (!uuid || uuid === "VirtualWallet") return "VirtualWallet";
            if (!uuid.startsWith("User.")) return uuid;
            const user = game.users.get(uuid.split(".")[1]);
            return this._getIdentity(user);
        };

        const sourceId = resolveTarget(fromUuid);
        const targetId = resolveTarget(toUuid);

        const fromIsVirtual = sourceId === "VirtualWallet" || sourceId.startsWith("User.");
        const toIsVirtual = targetId === "VirtualWallet" || targetId.startsWith("User.");

        let fromObj = null;
        if (fromIsVirtual) {
            fromObj = (sourceId === "VirtualWallet") ? game.user : game.users.get(sourceId.split(".")[1]);
        } else {
            fromObj = fromUuidSync(sourceId);
        }

        let toObj = null;
        if (toIsVirtual) {
            toObj = (targetId === "VirtualWallet") ? game.user : game.users.get(targetId.split(".")[1]);
        } else {
            toObj = fromUuidSync(targetId);
        }

        if (!fromObj || !toObj) {
            console.error(`[Virtual Agent] Transfer Fault: ${fromObj ? "Target" : "Source"} identified but not found.`);
            return false;
        }

        const fromEB = fromIsVirtual ? this._getVirtualBalance(fromObj) : this._getActorEurobucks(fromObj);
        const toEB = toIsVirtual ? this._getVirtualBalance(toObj) : this._getActorEurobucks(toObj);

        const fromName = fromIsVirtual ? (sourceId === "VirtualWallet" ? "System Fund" : fromObj.name) : fromObj.name;
        const toName = toIsVirtual ? (targetId === "VirtualWallet" ? "System Fund" : toObj.name) : toObj.name;

        const newSenderBalance = Number(fromEB.balance) - amount;
        const newReceiverBalance = Number(toEB.balance) + amount;

        console.log(`[Virtual Agent] Settling: ${fromName} -> ${toName} (${amount}eb)`);

        // E1 (5.8.42): reject overdraft. The GM "System Fund" (VirtualWallet) is the
        // intended money tap and may run negative; every other source — a character
        // wallet or a player's virtual balance — must actually have the funds. The UI
        // checks this client-side, but the GM-socket transfer relay and auction
        // settlement route through here and assumed this function would reject an
        // insufficient balance. It didn't, so a forged request or an insolvent auction
        // winner could be driven negative.
        if (sourceId !== "VirtualWallet" && Number(fromEB.balance) < amount) {
            console.warn(`[Virtual Agent] _executeTransfer rejected — ${fromName} has ${fromEB.balance}eb, needs ${amount}eb`);
            return false;
        }

        // Payer write
        if (fromIsVirtual) {
            await fromObj.setFlag("VirtualAgent", "virtualWalletBalance", newSenderBalance);
            let txs = fromObj.getFlag("VirtualAgent", "virtualWalletTransactions") || [];
            txs.push({ label: `To ${toName}: ${memo}`, amount, isPositive: false, date: new Date().toLocaleString() });
            await fromObj.setFlag("VirtualAgent", "virtualWalletTransactions", JSON.parse(JSON.stringify(txs)));
        } else if (typeof fromObj.deltaLedgerProperty === 'function') {
            // CPR-aware path: writes value + pushes to system.wealth.transactions
            // (visible on the character sheet's Wealth tab).
            await fromObj.deltaLedgerProperty("wealth", -amount, `Agent: To ${toName} - ${memo}`);
        } else {
            // Fallback for non-CPR systems
            await fromObj.update({ [fromEB.path]: newSenderBalance });
            let txs = fromObj.getFlag("VirtualAgent", "transactions") || [];
            txs.push({ label: `To ${toName}: ${memo}`, amount, isPositive: false, date: new Date().toLocaleString() });
            await fromObj.setFlag("VirtualAgent", "transactions", txs);
        }

        // Receiver write
        if (toIsVirtual) {
            await toObj.setFlag("VirtualAgent", "virtualWalletBalance", newReceiverBalance);
            let txs = toObj.getFlag("VirtualAgent", "virtualWalletTransactions") || [];
            txs.push({ label: `From ${fromName}: ${memo}`, amount, isPositive: true, date: new Date().toLocaleString() });
            await toObj.setFlag("VirtualAgent", "virtualWalletTransactions", JSON.parse(JSON.stringify(txs)));
        } else if (typeof toObj.deltaLedgerProperty === 'function') {
            await toObj.deltaLedgerProperty("wealth", amount, `Agent: From ${fromName} - ${memo}`);
        } else {
            await toObj.update({ [toEB.path]: newReceiverBalance });
            let txs = toObj.getFlag("VirtualAgent", "transactions") || [];
            txs.push({ label: `From ${fromName}: ${memo}`, amount, isPositive: true, date: new Date().toLocaleString() });
            await toObj.setFlag("VirtualAgent", "transactions", txs);
        }

        // Broadcast Sync — now includes balances so consumers don't see `undefined`
        game.socket.emit("module.VirtualAgent", {
            action: "transferConfirmed",
            senderUuid: sourceId,
            receiverUuid: targetId,
            amount,
            senderBalance: newSenderBalance,
            receiverBalance: newReceiverBalance
        });

        // Whisper targets
        const getWhisperIds = (obj) => {
            if (obj instanceof User) return [obj.id];
            if (obj instanceof Actor) return game.users.filter(u => obj.testUserPermission(u, "OWNER")).map(u => u.id);
            return [];
        };
        const whisperTargets = new Set([...getWhisperIds(fromObj), ...getWhisperIds(toObj), ...game.users.filter(u => u.isGM).map(u => u.id)]);

        // HTML-escape user-controllable strings before interpolating into chat HTML.
        const esc = (s) => (foundry.utils.escapeHTML
            ? foundry.utils.escapeHTML(String(s ?? ""))
            : String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
        ChatMessage.create({
            content: `
                <div style="border: 2px solid #00ff9f; background: #111; padding:10px; border-radius: 4px; color: #fff; font-family: monospace;">
                    <b style="color:#00ff9f">CITY BANK: SETTLEMENT</b><br>
                    <div style="margin-top:5px; border-top:1px solid #333; padding-top:5px;">
                        <span style="color:#ff3355">DEBIT</span>: ${esc(fromName)}<br>
                        <span style="color:#00ff9f">CREDIT</span>: ${esc(toName)}<br>
                        <span>AMOUNT</span>: ${Number(amount)}eb<br>
                        <span style="color:#888; font-size:0.75rem;">MEMO: ${esc(memo)}</span>
                    </div>
                </div>`,
            whisper: Array.from(whisperTargets),
            flags: { VirtualAgent: { isAgentMessage: false } }
        });

        return true;
    }

    _getPartyPlayers() {
        return game.users.filter(u => !u.isGM).map(u => ({ id: u.id, name: VA_displayName(u), actorUuid: this._getIdentity(u) }));
    }

    async _pushShard(targetId, title, content) {
        const newShard = {
            id: foundry.utils.randomID(),
            name: title,
            content: content,
            source: "ZIGGURAT_GM_INJECTION",
            date: new Date().toLocaleDateString(),
            timestamp: Date.now()
        };

        if (targetId === "broadcast") {
            const targetIds = [];
            for (let player of this._getPartyPlayers()) {
                const user = game.users.get(player.id);
                if (!user) continue;
                let shards = user.getFlag("VirtualAgent", "shards") || [];
                shards.push(newShard);
                await user.setFlag("VirtualAgent", "shards", shards);
                targetIds.push(player.id);
            }
            // Notify all players so their UI refreshes immediately
            game.socket.emit("module.VirtualAgent", { action: "shardDelivered", targetUserIds: targetIds });
            ui.notifications.info("Agent Data: Broadcast complete.");
        } else {
            const user = game.users.get(targetId);
            if (!user) return;
            let shards = user.getFlag("VirtualAgent", "shards") || [];
            shards.push(newShard);
            await user.setFlag("VirtualAgent", "shards", shards);
            // Notify the target player so their UI refreshes immediately
            game.socket.emit("module.VirtualAgent", { action: "shardDelivered", targetUserIds: [targetId] });
            ui.notifications.info(`Agent Data: Shard injected to ${user.name}.`);
        }

    }

    async _deleteShard(shardId, ownerId) {
        if (game.user.isGM && ownerId) {
            // GM deleting from a specific user's shards
            const targetUser = game.users.get(ownerId);
            if (targetUser) {
                let shards = targetUser.getFlag("VirtualAgent", "shards") || [];
                shards = shards.filter(s => s.id !== shardId);
                await targetUser.setFlag("VirtualAgent", "shards", shards);
            }
        } else {
            // Player (or GM with no ownerId) deleting from own shards
            let shards = game.user.getFlag("VirtualAgent", "shards") || [];
            shards = shards.filter(s => s.id !== shardId);
            await game.user.setFlag("VirtualAgent", "shards", shards);
        }
        ui.notifications.warn("Agent Data: Record purged from buffer.");
    }

    // --- AUCTION HOUSE: Settle winner ---
    async _settleAuction(auctionId) {
        let auctions = [];
        try { auctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
        const auction = auctions.find(a => a.id === auctionId);
        if (!auction) return;

        if (!auction.highBidderId) {
            ui.notifications.warn("Agent Auction: No bids placed — removing listing.");
            auctions = auctions.filter(a => a.id !== auctionId);
            this._pendingAuctionData = auctions;
            this.render(true);
            game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(auctions)).then(() => {
                this._pendingAuctionData = null;
                game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
            });
            return;
        }

        // Patch4 (Gotto Goho NPC bidder follow-up): if the winning bid was
        // placed via the GM-only NPC bid path, the "winner" isn't a real user.
        // Skip the transfer (no real wallet to deduct from — the GM handles
        // off-screen NPC bookkeeping however they like), mark settled, and
        // notify only the GMs since there's no player on the other side.
        const isNpcWinner = String(auction.highBidderId || "").startsWith("npc:") || auction.isNpcBid;

        // Patch4.6: GM-as-winner — the GM runs the house, doesn't pay itself.
        // Previously `_getIdentity(GM)` resolved to whatever owned actor was
        // around (often a 0-balance test NPC) and the transfer failed with
        // "winner may lack funds." Treat GM-winner same as NPC-winner: skip
        // the deduction, mark settled with a manual-handoff note.
        const winnerUser = isNpcWinner ? null : game.users.get(auction.highBidderId);
        const isGmWinner = !!(winnerUser && winnerUser.isGM);

        if (!isNpcWinner && !isGmWinner) {
            // Real player winner: deduct eb from them.
            if (!winnerUser) { ui.notifications.error("Agent Auction: Winner not found."); return; }
            const winnerIdentity = this._getIdentity(winnerUser);
            const success = await this._executeTransfer(winnerIdentity, "VirtualWallet", auction.currentBid, `Auction: ${auction.name}`);
            if (!success) { ui.notifications.error("Agent Auction: Payment failed — winner may lack funds."); return; }
        }

        // Mark as settled
        auction.settled = true;
        this._pendingAuctionData = auctions;

        // Notify (skip the auctionWon socket for NPC/GM winners — no player to alert)
        if (!isNpcWinner && !isGmWinner) {
            game.socket.emit("module.VirtualAgent", {
                action: "auctionWon",
                auctionId: auctionId,
                winnerId: auction.highBidderId,
                itemName: auction.name,
                amount: auction.currentBid
            });
        }

        const settlementSuffix = isNpcWinner
            ? " (NPC — manual handoff)"
            : (isGmWinner ? " (GM win — house keeps it)" : "");
        ui.notifications.info(`Agent Auction: "${auction.name}" sold to ${auction.highBidderName} for ${auction.currentBid}eb!${settlementSuffix}`);
        this._auctionView = 'list'; this._auctionDetailId = null;
        this.render(true);
        game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(auctions)).then(() => {
            this._pendingAuctionData = null;
            game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
        });
    }
}

globalThis.AgentDeviceApp = globalThis.AgentDeviceApp || {};

Hooks.once('init', async function() {
    globalThis.AgentOSApplication = AgentOSApplication;
    globalThis.AgentDeviceApp.ui = new AgentOSApplication();

    // Preload templates to avoid first-render flash
    await loadTemplates(["modules/VirtualAgent/templates/agent-ui.hbs"]);

    Handlebars.registerHelper('eq', function (a, b) {
        return a === b;
    });

    Handlebars.registerHelper('contains', function (list, item) {
        if (!list || !Array.isArray(list)) return false;
        return list.includes(item);
    });
});

// Auto-refresh when our user's flags change (e.g. GM pushed a shard via setFlag)
Hooks.on('updateUser', (user, changes, options, userId) => {
    if (user.id !== game.user.id) return;
    if (!foundry.utils.hasProperty(changes, "flags.VirtualAgent")) return;
    const app = globalThis.AgentDeviceApp?.ui;
    if (!app?.rendered) return;
    // 1.7.2 — route through the shared throttle (main.js _queueAgentRender) instead of a
    // direct render. A burst of VirtualAgent flag writes (unreads on a chatty turn, or the
    // one-time app-unlock migration writing back from getData) would each fire an immediate
    // full re-render — the same click-unbinding thrash SC used to cause. Throttled = ~4/sec.
    if (typeof _queueAgentRender === 'function') _queueAgentRender();
    else app.render(true);
});

// Auto-refresh wallet when the actor's eb / flags change (sheet edits, other modules, etc.)
Hooks.on('updateActor', (actor, changes, options, userId) => {
    const app = globalThis.AgentDeviceApp?.ui;
    if (!app?.rendered) return;
    if (actor.uuid !== app.actorUuid) return;
    // Only re-render if something we display actually changed
    const touchesWallet = foundry.utils.hasProperty(changes, "system.wealth")
        || foundry.utils.hasProperty(changes, "system.currency")
        || foundry.utils.hasProperty(changes, "system.derivedStats.hp")
        || foundry.utils.hasProperty(changes, "flags.VirtualAgent");
    if (touchesWallet) app.render(false);
});

// Wire the AUTHORIZE button injected by the chat-fallback. Runs only on GM clients.
// Dedupe via requestId so that (a) the socket-path and the chat-fallback don't
// both execute the same transfer, and (b) two GMs clicking the same card can't
// double-spend.
// Patch3: dedup tracker is now a Map<requestId, timestamp> with a 5-min TTL
// (helpers below) so it can't grow unbounded across long sessions.
globalThis.__AgentDeviceTransfersHandled = globalThis.__AgentDeviceTransfersHandled instanceof Map
    ? globalThis.__AgentDeviceTransfersHandled
    : new Map();
const __XFER_DEDUP_TTL_MS = 5 * 60 * 1000;
function __xferHasHandled(id) {
    if (!id) return false;
    const m = globalThis.__AgentDeviceTransfersHandled;
    const ts = m.get(id);
    if (!ts) return false;
    if (Date.now() - ts > __XFER_DEDUP_TTL_MS) { m.delete(id); return false; }
    return true;
}
function __xferMarkHandled(id) {
    if (!id) return;
    const m = globalThis.__AgentDeviceTransfersHandled;
    m.set(id, Date.now());
    const cutoff = Date.now() - __XFER_DEDUP_TTL_MS;
    for (const [k, v] of m) { if (v < cutoff) m.delete(k); }
}
function __xferUnmark(id) {
    if (!id) return;
    globalThis.__AgentDeviceTransfersHandled.delete(id);
}
Hooks.on('renderChatMessage', (message, html) => {
    if (!game.user.isGM) return;
    if (!message.flags?.VirtualAgent?.isTransferRequest) return;
    html.find('.agent-transfer-authorize').off('click.agentAuth').on('click.agentAuth', async (ev) => {
        ev.preventDefault();
        const btn = $(ev.currentTarget);
        if (btn.prop('disabled')) return;
        const requestId   = String(btn.data('request-id') || "");
        if (__xferHasHandled(requestId)) {
            btn.prop('disabled', true).text("ALREADY AUTHORIZED");
            return;
        }
        btn.prop('disabled', true).text("PROCESSING...");
        const fromUuid    = btn.data('from-uuid');
        const toUuid      = btn.data('to-uuid');
        const amount      = parseInt(btn.data('amount'));
        const memo        = String(btn.data('memo') || "");
        const requesterId = btn.data('requester-id');
        console.log("[Virtual Agent] Chat-fallback AUTHORIZE clicked", { fromUuid, toUuid, amount, memo, requesterId, requestId });
        const app = globalThis.AgentDeviceApp?.ui;
        if (!app) { ui.notifications.error("Virtual Agent: app not ready"); btn.prop('disabled', false).text("AUTHORIZE"); return; }
        __xferMarkHandled(requestId);
        const ok = await app._executeTransfer(fromUuid, toUuid, amount, memo || "Player transfer (authorized)");
        if (ok) { btn.text("AUTHORIZED").css({ background: 'rgba(0,255,128,0.15)', color: '#0fa' }); }
        else    {
            __xferUnmark(requestId);
            btn.prop('disabled', false).text("RETRY");
            ui.notifications.error("Virtual Agent: transfer failed");
        }
    });
});

Hooks.once('ready', function() {
    // Single canonical socket listener for the Virtual Agent
    game.socket.on("module.VirtualAgent", async (data) => {
        const app = globalThis.AgentDeviceApp?.ui;

        // 1.5.0 — reactive dodge: the defender's owner is prompted to roll Evasion before damage.
        if (data.action === "combatDodgeQuery") {
            try {
                if (game.user.id === data.attackerUserId) return;
                const tgt = fromUuidSync(data.targetUuid);
                if (!(tgt instanceof Actor)) return;
                const mine = tgt.hasPlayerOwner
                    ? (tgt.testUserPermission(game.user, "OWNER") && !game.user.isGM)   // PC → its player(s)
                    : game.user.isGM;                                                   // NPC → the GM
                if (!mine) return;
                globalThis.__VAdodgeSeen = globalThis.__VAdodgeSeen || new Set();
                if (globalThis.__VAdodgeSeen.has(data.reqId)) return;   // one prompt per request
                globalThis.__VAdodgeSeen.add(data.reqId);
                if (!app || typeof app._showDodgeDialog !== "function") return;
                app._showDodgeDialog(tgt, data.attackerName, data.weaponName, data.canDodge !== false, (dodged, ev) => {
                    game.socket.emit("module.VirtualAgent", { action: "combatDodgeResponse", reqId: data.reqId, attackerUserId: data.attackerUserId, dodged, evasionTotal: ev });
                }, data.attackTotal);
            } catch (e) { console.warn("[VirtualAgent] combatDodgeQuery failed:", e); }
            return;
        }
        if (data.action === "combatDodgeResponse") {
            try {
                if (game.user.id !== data.attackerUserId) return;
                // 1.7.0 — resolve the pending reactive-dodge Promise that the attack is awaiting
                const finish = app?._pendingDodges?.[data.reqId];
                if (finish) {
                    if (data.dodged) ui.notifications.info(`Defender dodges (Evasion ${Number(data.evasionTotal) || 0}).`);
                    else ui.notifications.info("Defender takes the hit.");
                    finish({ dodged: !!data.dodged, evasionTotal: Number(data.evasionTotal) || 0 });
                }
            } catch (e) { console.warn("[VirtualAgent] combatDodgeResponse failed:", e); }
            return;
        }

        if (data.action === "agentTyping" || data.action === "agentTypingStop") {
            if (app) app._handleTypingEvent(data, data.action === "agentTypingStop");
            return;
        }
        // Patch3.2 round 2: holophone animation sync. Every client (including
        // non-GMs and observers) runs its own local sequence so each one uses
        // its own JB2A asset availability rather than the originator's.
        if (data.action === "holophoneStart") {
            if (app) {
                try { app._runHolophoneCallAnimLocal(data.tokenId); } catch (e) { console.warn("[Virtual Agent] holophone local start failed:", e); }
            }
            return;
        }
        if (data.action === "holophoneStop") {
            if (app) {
                try { app._runHolophoneCallAnimStopLocal(data.tokenId); } catch (e) { console.warn("[Virtual Agent] holophone local stop failed:", e); }
            }
            return;
        }
        if (data.action === "refreshOnlineStatus") {
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "refreshSkin") {
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "shardDelivered") {
            // GM pushed a shard — if this client is a target, re-render + notify.
            // Delay render to let Foundry's own flag update propagate first.
            if (Array.isArray(data.targetUserIds) && data.targetUserIds.includes(game.user.id)) {
                ui.notifications.info("Agent Data: New data shard received in your DataPool.");
                setTimeout(() => { if (app?.rendered) app.render(true); }, 1500);
            }
            return;
        }
        if (data.action === "refreshApps") {
            if (app?.rendered && (!data.actorUuid || app.actorUuid === data.actorUuid)) {
                app.render(true);
            }
            return;
        }
        // 5.8.41: GM advances the turn on behalf of the active player (players own their
        // combatant but not the Combat document, so a player's own nextTurn() would reject).
        if (data.action === "combatNextTurn") {
            if (!game.user.isGM) return;
            // Only the designated active GM processes, so multiple connected GMs don't double-advance.
            if (game.users.activeGM && game.users.activeGM.id !== game.user.id) return;
            try {
                const combat = (data.combatId ? game.combats.get(data.combatId) : null) || game.combat;
                if (!combat || !combat.started) return;
                // Security: only the OWNER of the current combatant may end its turn.
                const reqUser = game.users.get(data.requesterId);
                const cur = combat.combatant;
                if (!reqUser || !cur?.actor || !cur.actor.testUserPermission(reqUser, "OWNER")) {
                    console.warn(`[AgentDevice 5.8.41] combatNextTurn denied for ${reqUser?.name || data.requesterId}`);
                    return;
                }
                await combat.nextTurn();
            } catch (e) { console.error('[AgentDevice 5.8.41] combatNextTurn failed:', e); }
            return;
        }
        // 5.8.30: GM-side stabilize heal for non-owners
        if (data.action === "combatStabilizeHeal") {
            if (!game.user.isGM) return;
            try {
                const t = await fromUuid(data.targetUuid);
                if (t) {
                    if (t.system?.derivedStats?.hp?.value !== undefined) await t.update({ 'system.derivedStats.hp.value': 1 });
                    else if (t.system?.hp?.value !== undefined) await t.update({ 'system.hp.value': 1 });
                    // 5.8.32: Stabilization resets Death Save Penalty to Base (pg 187)
                    try {
                        const _base = Number(t.getFlag?.('VirtualAgent', 'deathSaveBasePenalty') ?? 0);
                        await t.setFlag?.('VirtualAgent', 'deathSavePenalty', _base);
                    } catch (e) {}
                    console.log(`[AgentDevice 5.8.30] GM-side stabilized ${t.name} to 1 HP`);
                }
            } catch (e) { console.error('[AgentDevice 5.8.30] stabilize heal failed:', e); }
            return;
        }
        // 5.8.25: GM-side critical injury roll (player attacker emits, GM rolls authoritative)
        if (data.action === "combatRollCriticalInjury") {
            if (!game.user.isGM) return;
            const app = globalThis.AgentDeviceApp?.ui;
            if (app?._rollCriticalInjury) {
                await app._rollCriticalInjury({
                    targetUuid: data.targetUuid, targetName: data.targetName,
                    attackerName: data.attackerName, location: data.location || 'body',
                    forcedInjury: data.forcedInjury || null,                       // 5.8.32
                    bumpDeathSavePenalty: !!data.bumpDeathSavePenalty              // 5.8.32
                });
            }
            return;
        }
        // 5.8.23: GM applies damage on behalf of a player who can't update target's ActorDelta
        if (data.action === "combatApplyDamage") {
            if (!game.user.isGM) return;
            try {
                const target = await fromUuid(data.targetUuid);
                if (!target) {
                    console.warn("[AgentDevice 5.8.23] GM-side: target uuid not resolved:", data.targetUuid);
                    return;
                }
                console.log(`[AgentDevice 5.8.23] GM-side: ${data.attackerName} dealt ${data.damageAmount} to ${target.name}`);
                // Armor ablation first (if applicable)
                // 5.8.32: ablate the hit location — head shots used to ablate body armor here too.
                if (data.ablateArmor && Number(data.armorSP) > 0) {
                    if (data.armorLocation === 'head') {
                        if (target.system?.externalData?.currentArmorHead !== undefined) {
                            await target.update({ 'system.externalData.currentArmorHead.value': Math.max(0, Number(data.armorSP) - (Number(data.ablateBy) || 1)) });
                        } else if (target.system?.externalData?.armor?.head !== undefined) {
                            await target.update({ 'system.externalData.armor.head': Math.max(0, Number(data.armorSP) - (Number(data.ablateBy) || 1)) });
                        }
                    } else if (target.system?.externalData?.currentArmorBody !== undefined) {
                        await target.update({ 'system.externalData.currentArmorBody.value': Math.max(0, Number(data.armorSP) - (Number(data.ablateBy) || 1)) });
                    } else if (target.system?.externalData?.armor?.body !== undefined) {
                        await target.update({ 'system.externalData.armor.body': Math.max(0, Number(data.armorSP) - (Number(data.ablateBy) || 1)) });
                    }
                }
                // HP application
                if (Number(data.damageAmount) > 0) {
                    const _hpCur = Number(target.system?.derivedStats?.hp?.value ?? target.system?.hp?.value ?? 0);
                    const _hpFloor = (data.rubberNonLethal && _hpCur > 1) ? 1 : 0;  // 1.7.1 — Rubber leaves a target above 1 HP at min 1 (CPR pg 345)
                    const _hpNew = Math.max(_hpFloor, _hpCur - Number(data.damageAmount));
                    if (target.system?.derivedStats?.hp?.value !== undefined) {
                        await target.update({ 'system.derivedStats.hp.value': _hpNew });
                    } else if (target.system?.hp?.value !== undefined) {
                        await target.update({ 'system.hp.value': _hpNew });
                    }
                }
            } catch (e) {
                console.error("[AgentDevice 5.8.23] GM-side damage apply failed:", e);
            }
            return;
        }
        if (data.action === "gardenAddProfile") {
            // 1.6.0 — a player posted a Garden profile; only the active GM writes the world setting.
            if (!game.user.isGM) return;
            if (game.users.activeGM && game.users.activeGM.id !== game.user.id) return;
            try {
                const p = data.profile;
                if (p && p.name) {
                    // 1.8.0 — player-uploaded photo: GM stores it in the dedicated garden folder.
                    // Trust boundary: strict data-URL validation (image mime + base64 charset),
                    // hard size cap, and a GM-generated filename — never player input (no path
                    // games). On any failure the profile still posts, just without the photo.
                    let _uploadedPhoto = null;
                    const _up = data.photoUpload;
                    if (typeof _up === "string" && _up.length <= 1000000
                        && /^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(_up)) {
                        try {
                            const dir = await app._ensureGardenUploadDir();
                            const blob = await (await fetch(_up)).blob();
                            const ext = blob.type === "image/webp" ? "webp" : (blob.type === "image/jpeg" ? "jpg" : (blob.type === "image/gif" ? "gif" : "png"));
                            const f = new File([blob], `garden-${foundry.utils.randomID()}.${ext}`, { type: blob.type });
                            const res = await FilePicker.upload("data", dir, f, {}, { notify: false });
                            if (res?.path) _uploadedPhoto = res.path;
                        } catch (e) { console.warn("[VirtualAgent] garden relay upload failed:", e); }
                    }
                    let list = [];
                    try { list = JSON.parse(game.settings.get("VirtualAgent", "gardenProfiles") || "[]"); } catch (e) {}
                    // whitelist + clamp the fields a player can send
                    list.push({
                        id: typeof p.id === "string" ? p.id : ("g_" + foundry.utils.randomID()),
                        name: String(p.name).slice(0, 80),
                        age: String(p.age || "").slice(0, 20),
                        photo: _uploadedPhoto || String(p.photo || "").slice(0, 500),
                        bio: String(p.bio || "").slice(0, 1000),
                        interests: String(p.interests || "").slice(0, 300),
                        availability: String(p.availability || "Active").slice(0, 40),
                        targetUserIds: [],
                        addedBy: typeof p.addedBy === "string" ? p.addedBy : null
                    });
                    await game.settings.set("VirtualAgent", "gardenProfiles", JSON.stringify(list));
                }
            } catch (e) { console.warn("[VirtualAgent] gardenAddProfile failed:", e); }
            return;
        }
        if (data.action === "socialFeedAppend") {
            if (!game.user.isGM) return;
            // 5.8.43: with multiple GMs connected, every GM ran this and appended the post
            // (each with a fresh id) — duplicate posts. Only the designated active GM writes.
            if (game.users.activeGM && game.users.activeGM.id !== game.user.id) return;
            console.log("[Virtual Agent] socialFeedAppend received:", data);
            const raw = game.settings.get("VirtualAgent", "socialFeedArticles");
            let list = [];
            try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
            // Validate + whitelist the entry. Identity is taken from the entry's
            // claimed authorId but cross-checked against an active user; if the
            // claimed author isn't an active session the post is dropped.
            const e = data.entry || {};
            const text = String(e.text || "").slice(0, 2000).trim();
            const category = String(e.category || "Post").slice(0, 60).trim() || "Post";
            const claimedAuthor = game.users.get(e.authorId);
            if (!text || !claimedAuthor || !claimedAuthor.active) {
                console.warn("[Virtual Agent] socialFeedAppend dropped — invalid text or author");
                return;
            }
            const safeEntry = {
                id: "feed_" + foundry.utils.randomID(),
                category,
                text,
                authorId: claimedAuthor.id,
                authorName: VA_displayName(claimedAuthor),
                timestamp: Date.now()
            };
            list.push(safeEntry);
            await game.settings.set("VirtualAgent", "socialFeedArticles", JSON.stringify(list));
            return;
        }
        if (data.action === "socialFeedDelete") {
            console.log("[Virtual Agent] socket received socialFeedDelete", data);
            if (!game.user.isGM) return;
            // 5.8.43: single active-GM guard so multiple GMs don't each rewrite the feed.
            if (game.users.activeGM && game.users.activeGM.id !== game.user.id) return;
            const raw = game.settings.get("VirtualAgent", "socialFeedArticles");
            let list = [];
            try { list = Array.isArray(raw) ? raw : (raw && raw.trim() ? JSON.parse(raw) : []); } catch(e){}
            const entry = list.find(e => e.id === data.postId);
            if (!entry) { console.warn("[Virtual Agent] socialFeedDelete: entry not found", data.postId); return; }
            // Author check: only the original poster or any GM can delete
            if (entry.authorId !== data.requesterId) {
                console.warn("[Virtual Agent] socialFeedDelete: requester is not the author", { requesterId: data.requesterId, authorId: entry.authorId });
                return;
            }
            const next = list.filter(e => e.id !== data.postId);
            await game.settings.set("VirtualAgent", "socialFeedArticles", JSON.stringify(next));
            console.log("[Virtual Agent] socialFeedDelete: post removed", data.postId);
            return;
        }
        if (data.action === "storeCheckout") {
            if (!game.user.isGM) return;
            console.log("[Virtual Agent] storeCheckout received:", data);
            const actor = fromUuidSync(data.actorUuid);
            if (!(actor instanceof Actor)) {
                game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: target actor not found." });
                return;
            }
            const senderUser = game.users.get(data.requesterId);
            if (!senderUser || !actor.testUserPermission(senderUser, "OWNER")) {
                game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: requester does not own target actor." });
                return;
            }
            // Re-validate amount + balance on the server.
            // E4 (5.8.42): authoritative total is recomputed server-side from the cart —
            // never trust the client's data.total (a forged payload could send the real
            // cart with total:1 and buy everything for a euro). Same formula as the client.
            const total = (Array.isArray(data.cart) ? data.cart : []).reduce((s, e) => s + (Number(e.price) || 0) * (Number(e.qty) || 0), 0);
            if (!Number.isFinite(total) || total <= 0) {
                game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: invalid total." });
                return;
            }
            const balance = app._getActorEurobucks(actor).balance;
            if (balance < total) {
                game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: "Store: insufficient funds on server." });
                return;
            }
            // Patch3.2: enforce GM gates server-side too — a stale cached
            // catalog or hand-crafted socket payload can't bypass the cap/blacklist.
            try {
                const maxPrice  = Number(game.settings.get("VirtualAgent", "storeMaxPrice")) || 0;
                const blacklist = String(game.settings.get("VirtualAgent", "storeBlacklistIds") || "");
                const blockedSet = new Set(blacklist.split(/[,\n]/).map(s => s.trim().toLowerCase()).filter(Boolean));
                // E5 (5.8.42): enforce the Fixer-rank gate server-side too (was display-only).
                const gatePrice = Number(game.settings.get("VirtualAgent", "storeFixerGatePrice")) || 0;
                const gateRank  = Number(game.settings.get("VirtualAgent", "storeFixerGateRank"))  || 0;
                const buyerRank = Number(senderUser.getFlag("VirtualAgent", "fixerRank")) || 0;
                const cart = Array.isArray(data.cart) ? data.cart : [];
                for (const ci of cart) {
                    if (gatePrice > 0 && gateRank > 0 && buyerRank < gateRank && Number(ci.price) > gatePrice) {
                        game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: `Store: "${ci.name}" requires Fixer rank ${gateRank}.` });
                        return;
                    }
                    if (maxPrice > 0 && Number(ci.price) > maxPrice) {
                        game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: `Store: "${ci.name}" exceeds the GM's price cap (${maxPrice}eb).` });
                        return;
                    }
                    if (blockedSet.size) {
                        const uuidLc = String(ci.uuid || "").toLowerCase();
                        const nameLc = String(ci.name || "").toLowerCase();
                        if (blockedSet.has(uuidLc) || blockedSet.has(nameLc)) {
                            game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: `Store: "${ci.name}" is blacklisted by the GM.` });
                            return;
                        }
                    }
                }
            } catch (e) { console.warn("[Virtual Agent] Store gate enforcement failed:", e); }
            await app._processCheckout(actor, data.cart || [], total, VA_displayName(senderUser));
            return;
        }
        if (data.action === "transferRequest") {
            console.log("[Virtual Agent] socket received transferRequest event (any client)", data);
            // Only the GM client validates and executes player-initiated transfers.
            if (!game.user.isGM) {
                console.log("[Virtual Agent] transferRequest ignored — not GM client");
                return;
            }
            // Dedup against chat-fallback path so we don't double-spend.
            // Patch3: uses TTL-backed helpers so the dedup map self-prunes.
            const _reqId = String(data.requestId || "");
            if (__xferHasHandled(_reqId)) {
                console.log("[Virtual Agent] transferRequest already handled — skipping", _reqId);
                return;
            }
            console.log("[Virtual Agent] transferRequest received on GM client:", data);
            const _amt = Number(data.amount);
            if (!Number.isFinite(_amt) || _amt <= 0) {
                console.warn("[Virtual Agent] transferRequest rejected — invalid amount");
                game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.fromUuid, message: "Invalid transfer amount." });
                return;
            }
            __xferMarkHandled(_reqId);
            const senderUser = game.users.get(data.requesterId);
            if (!senderUser) {
                console.warn("[Virtual Agent] transferRequest: requester not found", data.requesterId);
                return;
            }
            // Verify the requester actually owns the source. Trust either:
            //   (a) their identity matches data.fromUuid (e.g., their character or virtual wallet), OR
            //   (b) explicit OWNER permission on the source actor.
            const claimedIdentity = app._getIdentity(senderUser);
            const srcActor = (data.fromUuid && !data.fromUuid.startsWith("User.") && data.fromUuid !== "VirtualWallet")
                ? fromUuidSync(data.fromUuid) : null;
            const identityMatches = (claimedIdentity === data.fromUuid);
            const hasOwnership = srcActor && srcActor.testUserPermission(senderUser, "OWNER");
            if (!identityMatches && !hasOwnership) {
                console.warn("[Virtual Agent] transferRequest denied — identity mismatch", { claimedIdentity, fromUuid: data.fromUuid });
                game.socket.emit("module.VirtualAgent", {
                    action: "errorResult",
                    actorUuid: data.fromUuid,
                    message: "Transfer denied: requester does not own the source account."
                });
                return;
            }
            const senderDisplayName = VA_displayName(senderUser);
            const _escTr = (s) => (foundry.utils.escapeHTML
                ? foundry.utils.escapeHTML(String(s ?? ""))
                : String(s ?? "").replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])));
            ui.notifications.info(`Agent Bank: ${senderDisplayName} → ${Number(data.amount)}eb transfer authorizing...`);
            ChatMessage.create({
                content: `<i style="color:#888;">Virtual Agent: Routing transferRequest from ${_escTr(senderDisplayName)} (${Number(data.amount)}eb)</i>`,
                whisper: game.users.filter(u => u.isGM).map(u => u.id),
                flags: { VirtualAgent: { isAgentMessage: false, isTransferTrace: true } }
            });
            const ok = await app._executeTransfer(data.fromUuid, data.toUuid, data.amount, data.memo || "Player transfer");
            console.log("[Virtual Agent] _executeTransfer result:", ok);
            if (!ok) {
                console.warn("[Virtual Agent] _executeTransfer returned false");
                game.socket.emit("module.VirtualAgent", {
                    action: "errorResult",
                    actorUuid: data.fromUuid,
                    message: "Transfer failed on the server."
                });
            }
            return;
        }
        if (data.action === "transferConfirmed") {
            // Reset any 'PROCESSING' buttons in the chat log
            $('.p2p-confirm-transfer:contains("PROCESSING"), .nfc-confirm-deduct:contains("PROCESSING")')
                .text("HANDSHAKE COMPLETE").prop('disabled', true);

            if (app) {
                const myId = app.actorUuid;
                const isRecipient = (myId === data.receiverUuid);
                const isSender = (myId === data.senderUuid);
                if (isRecipient || isSender) {
                    ui.notifications.info(`Virtual Agent: Transaction Confirmed (${data.amount}eb).`);
                    console.log(`[Virtual Agent] Post-sync render for ${myId}. Balances: S:${data.senderBalance} R:${data.receiverBalance}`);
                    setTimeout(() => app.render(true), 800);
                }
            }
            return;
        }
        if (data.action === "errorResult") {
            $('.p2p-confirm-transfer:contains("PROCESSING"), .nfc-confirm-deduct:contains("PROCESSING")')
                .text("RETRY").prop('disabled', false);
            if (app && app.actorUuid === data.actorUuid) {
                ui.notifications.error(`Virtual Agent: ${data.message}`);
                if (app.rendered) app.render(true);
            }
            return;
        }
        // --- AUCTION SOCKET HANDLERS ---
        if (data.action === "auctionBid") {
            if (!game.user.isGM) return;
            // Patch3: bidder identity check. Foundry sockets don't carry a sender
            // userId, but the client includes both `bidderId` and `requesterId`.
            // Require them to match and to map to an active user. Stops a client
            // from impersonating another player on a bid.
            if (!data.bidderId || data.bidderId !== data.requesterId) {
                console.warn("[Virtual Agent] auctionBid rejected — bidderId/requesterId mismatch", data);
                return;
            }
            const _bidderUser = game.users.get(data.bidderId);
            if (!_bidderUser || !_bidderUser.active) {
                console.warn("[Virtual Agent] auctionBid rejected — bidder not an active user", data.bidderId);
                return;
            }
            // Serialize concurrent bids — read-modify-write on a JSON setting is
            // not atomic, so chain bids on a single promise to avoid losing them
            // when two players bid in the same tick.
            globalThis.__AgentDeviceBidLock = (globalThis.__AgentDeviceBidLock || Promise.resolve())
                .then(async () => {
                    let auctions = [];
                    try { auctions = JSON.parse(game.settings.get("VirtualAgent", "auctionListings") || "[]"); } catch(e) {}
                    const auc = auctions.find(a => a.id === data.auctionId);
                    if (!auc) return;
                    if (auc.settled || (auc.endTime && Date.now() > auc.endTime)) {
                        game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: "Auction has ended." });
                        return;
                    }
                    // Coerce + validate the bid increment. Earlier versions used `||`
                    // which let string "50" through and produced string concatenation
                    // ("100" + "50" = "10050") instead of an integer add.
                    const bidIncrement = Number(data.bidIncrement ?? data.bidAmount);
                    if (!Number.isFinite(bidIncrement) || bidIncrement <= 0) {
                        game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: "Invalid bid amount." });
                        return;
                    }
                    const currentBid = Number(auc.currentBid) || 0;
                    const newTotal = currentBid + bidIncrement;
                    // Validate bidder has funds for the NEW TOTAL (skip if app not open)
                    const bidder = game.users.get(data.bidderId);
                    if (!bidder) return;
                    if (app) {
                        const bidderIdentity = app._getIdentity(bidder);
                        const bidderActor = app._resolveActor(bidderIdentity);
                        // E3 (5.8.42): a Virtual-Wallet bidder has no character actor, so the
                        // funds check used to be skipped entirely (bid anything). Fall back to
                        // the virtual balance so every bidder is actually checked.
                        const bal = bidderActor
                            ? Number(app._getActorEurobucks(bidderActor).balance) || 0
                            : Number(app._getVirtualBalance(bidder).balance) || 0;
                        if (bal < newTotal) {
                            game.socket.emit("module.VirtualAgent", { action: "errorResult", actorUuid: data.actorUuid, message: `Insufficient funds. Need ${newTotal}eb, have ${bal}eb.` });
                            return;
                        }
                    }
                    auc.currentBid = newTotal;
                    auc.highBidderId = data.bidderId;
                    auc.highBidderName = String(data.bidderName || bidder.name).slice(0, 60);
                    auc.bidCount = (Number(auc.bidCount) || 0) + 1;
                    // Optimistic UI: render with local data immediately, then persist
                    if (app) app._pendingAuctionData = auctions;
                    ui.notifications.info(`Agent Auction: ${auc.highBidderName} +${bidIncrement}eb on "${auc.name}" — now ${newTotal}eb.`);
                    if (app?.rendered) app.render(true);
                    await game.settings.set("VirtualAgent", "auctionListings", JSON.stringify(auctions));
                    if (app) app._pendingAuctionData = null;
                    game.socket.emit("module.VirtualAgent", { action: "auctionRefresh" });
                })
                .catch(err => console.error("[Virtual Agent] auctionBid handler failed:", err));
            return;
        }
        if (data.action === "auctionRefresh") {
            if (app) app._pendingAuctionData = null; // clear optimistic cache, server is authoritative now
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "groupInviteRelay") {
            // Patch5.0.1: relay from a non-GM creator. GM has permission to
            // setFlag on other users' customContacts. Push the group entry
            // onto every player member's contact list, skipping anyone who
            // already has it.
            if (!game.user.isGM) return;
            try {
                const group = data.group;
                if (!group?.id || !Array.isArray(group.members)) return;
                for (const m of group.members) {
                    if (!m.startsWith("player:")) continue;
                    const uid = m.slice("player:".length);
                    const u = game.users.get(uid);
                    if (!u) continue;
                    if (u.id === data.requestingUserId) continue; // creator already has it
                    const theirs = u.getFlag("VirtualAgent", "customContacts") || [];
                    if (!theirs.some(c => c.id === group.id)) {
                        theirs.push({ ...group });
                        await u.setFlag("VirtualAgent", "customContacts", theirs);
                    }
                }
            } catch (err) {
                console.error("[Virtual Agent] groupInviteRelay failed:", err);
            }
            return;
        }
       
        if (data.action === "clockUpdate") {
            if (app?.rendered) app.render(true);
            return;
        }
        if (data.action === "auctionWon") {
            if (data.winnerId === game.user.id) {
                ui.notifications.info(`Agent Auction: You won "${data.itemName}" for ${data.amount}eb! Collect from the GM.`);
            }
            if (app?.rendered) app.render(true);
            return;
        }
    });
});
