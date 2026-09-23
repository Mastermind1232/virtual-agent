/* ------------------------------------------------------------------ *
 *  NuNu packaging: the Operator app.
 *
 *  A Fixer's dispatch board. The owner receives gigs from clients,
 *  assigns the operators on their roster, and collects when the gig
 *  resolves against the in-game calendar. Rules live in the campaign
 *  vault under "Operator"; this file is the implementation.
 *
 *  Self-contained by design. It touches the upstream module at four
 *  points only (a tile, a view div, one getData line, one click line),
 *  so an upstream update costs minutes rather than an afternoon.
 * ------------------------------------------------------------------ */

(() => {
    const ID = "VirtualAgent";
    const ACCENT = "#9ef01a";

    /** Tier index -> label and how many of the runner's skills they may use. */
    const TIERS = [
        { name: "Newbie", skills: 1, gigs: 0 },
        { name: "Novice", skills: 2, gigs: 1 },
        { name: "Intermediate", skills: 3, gigs: 3 },
        { name: "Advanced", skills: 4, gigs: 6 },
        { name: "Veteran", skills: 5, gigs: 10 },
    ];

    /** Difficulty label -> DV. */
    const DIFF = [
        { name: "Easy", dv: 13 },
        { name: "Difficult", dv: 15 },
        { name: "Long Shot", dv: 17 },
        { name: "Suicide", dv: 21 },
    ];
    const diffName = (dv) => DIFF.find((d) => d.dv === Number(dv))?.name ?? `DV ${dv}`;

    /** Starting success chance by how many skills the gig carries. */
    const CAPS = { 1: 95, 2: 90, 3: 85, 4: 80, 5: 75 };

    const MISS = -25, FUMBLE = -50, PREEM = 25;

    /* ---------------------------------------------------------------- */
    /*  Small helpers                                                    */
    /* ---------------------------------------------------------------- */

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const uid = () => foundry.utils.randomID();

    const utc = ({ y, m, d }) => Date.UTC(y, m - 1, d);
    const fromUtc = (ms) => { const dt = new Date(ms); return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() }; };
    const addDays = (date, n) => fromUtc(utc(date) + n * 86400000);
    const dateKey = ({ y, m, d }) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

    const calendar = () => game.modules.get("nunu-calendar")?.api ?? null;
    const today = () => calendar()?.getDate?.() ?? null;
    const todayKey = () => { const t = today(); return t ? dateKey(t) : null; };
    const prettyDate = (k) => {
        const cal = calendar(); if (!cal || !k) return k ?? "";
        const [y, m, d] = k.split("-").map(Number);
        return cal.shortDate ? cal.shortDate({ y, m, d }) : k;
    };
    /** Days from today until a date key. Negative when the date has passed. */
    const daysUntil = (k) => {
        const t = today(); if (!t || !k) return null;
        const [y, m, d] = k.split("-").map(Number);
        return Math.round((utc({ y, m, d }) - utc(t)) / 86400000);
    };

    const readJSON = (setting) => {
        try { const raw = game.settings.get(ID, setting); const v = typeof raw === "string" ? JSON.parse(raw || "[]") : raw; return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
    };
    const writeJSON = (setting, value) => game.settings.set(ID, setting, JSON.stringify(value));

    const gigs = () => readJSON("operatorGigs");
    const runners = () => readJSON("operatorRunners");
    const saveGigs = (v) => writeJSON("operatorGigs", v);
    const saveRunners = (v) => writeJSON("operatorRunners", v);

    /* ---------------------------------------------------------------- */
    /*  Actors and skills                                                */
    /* ---------------------------------------------------------------- */

    const actorOf = (uuid) => { try { return uuid ? fromUuidSync(uuid) : null; } catch (e) { return null; } };

    /** Every skill the actor has ranks in, highest total first. Total is STAT + level. */
    function skillTotals(actor) {
        if (!actor) return [];
        return (actor.itemTypes?.skill ?? [])
            .filter((s) => (s.system?.level ?? 0) > 0)
            .map((s) => ({ name: s.name, total: (actor.system?.stats?.[s.system?.stat]?.value ?? 0) + (s.system?.level ?? 0) }))
            .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    }

    /** One named skill's total for an actor, STAT alone when they have no ranks. */
    function skillTotal(actor, name) {
        if (!actor) return 0;
        const key = String(name).trim().toLowerCase();
        const item = (actor.itemTypes?.skill ?? []).find((s) => s.name.trim().toLowerCase() === key);
        if (item) return (actor.system?.stats?.[item.system?.stat]?.value ?? 0) + (item.system?.level ?? 0);
        return 0;
    }

    const tierOf = (runner) => TIERS[Math.max(0, Math.min(TIERS.length - 1, runner?.tier ?? 0))];

    /** The skills this runner may use: their best, as many as the tier allows. */
    function usableSkills(runner) {
        const all = skillTotals(actorOf(runner?.actorUuid));
        return all.slice(0, tierOf(runner).skills);
    }

    /** The tier a completed-gig count earns. */
    const tierForGigs = (n) => { let t = 0; for (let i = 0; i < TIERS.length; i++) if (n >= TIERS[i].gigs) t = i; return t; };

    /* ---------------------------------------------------------------- */
    /*  Who sees the app                                                 */
    /* ---------------------------------------------------------------- */

    function ownerUser() {
        const v = String(game.settings.get(ID, "operatorOwner") || "").trim();
        if (!v) return null;
        const name = v.toLowerCase();
        return game.users.get(v)
            ?? game.users.find((u) => u.name.trim().toLowerCase() === name
                || (u.character?.name ?? "").trim().toLowerCase() === name)
            ?? null;
    }
    const isOwner = () => { const u = ownerUser(); return !!u && u.id === game.user.id; };
    /** One GM owns every write, so two clients can never clobber the same list. */
    const activeGM = () => game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
    const isActiveGM = () => activeGM()?.id === game.user.id;
    /** Redraw the phone only if it is already open; never pop it open on someone. */
    const renderPhone = () => { const a = globalThis.AgentDeviceApp?.ui; if (a?.rendered) a.render(true); };
    const visible = () => game.user.isGM || isOwner();
    const canEdit = () => game.user.isGM;

    /** The owner's own actor, used for the assist roll. */
    const ownerActor = () => { const u = ownerUser(); return u?.character ?? actorOf(u?.getFlag(ID, "lastActorUuid")) ?? null; };

    /* ---------------------------------------------------------------- */
    /*  The Agent's own contact list                                     */
    /*                                                                   */
    /*  An operator on the roster is someone the owner can call, so they */
    /*  get a Messenger contact too. Dropping them leaves the thread      */
    /*  alone: the history is still worth keeping.                        */
    /* ---------------------------------------------------------------- */

    async function giveContact(runnerName, img) {
        if (!game.user.isGM) return;                  // only a GM can write another user's flags
        const owner = ownerUser(); if (!owner) return;
        const key = String(runnerName).trim().toLowerCase();
        const same = (c) => String(c.originalName || c.name || "").trim().toLowerCase() === key;

        const gmList = game.user.getFlag(ID, "customContacts") || [];
        const existing = gmList.find(same);
        const record = {
            id: existing?.id ?? `npc_${uid()}`,
            name: runnerName, originalName: runnerName,
            avatar: (img && img !== "icons/svg/mystery-man.svg") ? img : (existing?.avatar ?? null),
            ownerId: game.user.id,
            targetUserIds: [...new Set([...(existing?.targetUserIds ?? []), owner.id])],
        };
        await game.user.setFlag(ID, "customContacts", [...gmList.filter((c) => !same(c)), record]);
        const theirs = owner.getFlag(ID, "customContacts") || [];
        await owner.setFlag(ID, "customContacts", [...theirs.filter((c) => !same(c)), record]);
    }

    /* ---------------------------------------------------------------- */
    /*  Client standing                                                  */
    /* ---------------------------------------------------------------- */

    const clientKey = (c) => String(c ?? "").trim().toLowerCase();

    /** Consecutive failures for a client, newest first. Three and they walk. */
    function clientStreak(client) {
        const key = clientKey(client);
        const done = gigs().filter((g) => g.status === "done" && clientKey(g.client) === key)
            // `resolved` is only a date, so same-day gigs tie; resolvedAt breaks it by the order they were settled.
            .sort((a, b) => String(b.resolved ?? "").localeCompare(String(a.resolved ?? "")) || (b.resolvedAt ?? 0) - (a.resolvedAt ?? 0));
        let streak = 0;
        for (const g of done) { if (g.outcome?.success) break; streak++; }
        return streak;
    }

    const dropped = () => readJSON("operatorDropped").map(clientKey);
    const hasDropped = (client) => dropped().includes(clientKey(client));

    /* ---------------------------------------------------------------- */
    /*  Resolution                                                       */
    /* ---------------------------------------------------------------- */

    /**
     * Rolls a gig out. Each skill the runner covers is rolled; each skill they
     * do not cover fails without dice unless Jan took the call. Two natural 1s
     * end the gig whatever the arithmetic says.
     */
    async function resolveGig(gig) {
        const runner = runners().find((r) => r.id === gig.runnerId) ?? null;
        const usable = usableSkills(runner).map((s) => s.name.trim().toLowerCase());
        const rActor = actorOf(runner?.actorUuid);
        const jActor = ownerActor();

        const lines = [];
        let chance = CAPS[gig.skills.length] ?? 80;
        let fumbles = 0;

        for (const skill of gig.skills) {
            const key = skill.name.trim().toLowerCase();
            const assisted = gig.assist && gig.assist.skill.trim().toLowerCase() === key;
            const covered = usable.includes(key);

            if (!covered && !assisted) {
                chance += MISS;
                lines.push({ skill: skill.name, dv: skill.dv, by: "nobody", text: "No one on the job could cover it", delta: MISS });
                continue;
            }

            const by = assisted ? (jActor?.name ?? "Operator") : (rActor?.name ?? runner?.name ?? "Runner");
            // An assist was rolled live when the call came in; that result stands.
            const total = assisted ? (gig.assist.total ?? 0) : skillTotal(rActor, skill.name);
            const die = assisted ? (gig.assist.die ?? 1) : (await new Roll("1d10").evaluate()).total;
            const sum = die + total;

            let delta = 0, text = "";
            if (die === 1) { fumbles++; delta = FUMBLE; text = `Fumble. ${total} + 1 against DV ${skill.dv}`; }
            else if (die === 10) { delta = PREEM; text = `Preem. ${total} + 10 = ${sum} against DV ${skill.dv}`; }
            else if (sum >= skill.dv) { delta = 0; text = `${total} + ${die} = ${sum} against DV ${skill.dv}`; }
            else { delta = MISS; text = `${total} + ${die} = ${sum} against DV ${skill.dv}`; }

            chance += delta;
            lines.push({ skill: skill.name, dv: skill.dv, by, text, delta, die });
        }

        const wiped = fumbles >= 2;
        chance = Math.max(0, Math.min(100, chance));
        const finalRoll = wiped ? 100 : (await new Roll("1d100").evaluate()).total;
        const success = !wiped && finalRoll <= chance;

        const fee = Number.isFinite(gig.fee) ? gig.fee : 20;
        const cut = success ? Math.round((Number(gig.payout) || 0) * (100 - fee) / 100) : 0;
        const keep = success ? (Number(gig.payout) || 0) - cut : 0;

        const outcome = { success, chance, finalRoll, wiped, fumbles, lines, cut, keep, fee };

        const list = gigs();
        const idx = list.findIndex((g) => g.id === gig.id);
        if (idx >= 0) { list[idx] = { ...list[idx], status: "done", outcome, resolved: todayKey() ?? "", resolvedAt: Date.now() }; await saveGigs(list); }

        // Three failures in a row and the client stops bringing work.
        if (!success && clientStreak(gig.client) >= 3 && !hasDropped(gig.client)) {
            await writeJSON("operatorDropped", [...readJSON("operatorDropped"), clientKey(gig.client)]);
        }

        if (success && runner) {
            const rl = runners();
            const ri = rl.findIndex((r) => r.id === runner.id);
            if (ri >= 0) {
                const completed = (rl[ri].completed ?? 0) + 1;
                const tier = tierForGigs(completed);
                const rose = tier > (rl[ri].tier ?? 0);
                rl[ri] = { ...rl[ri], completed, tier };
                await saveRunners(rl);
                if (rose) ChatMessage.create({ content: `<div style="font-family: monospace;"><b style="color:${ACCENT}">OPERATOR</b><br>${esc(rl[ri].name)} is now <b>${TIERS[tier].name}</b>, and can bring ${TIERS[tier].skills} skill${TIERS[tier].skills === 1 ? "" : "s"} to a gig.</div>`, whisper: whisperTargets() });
            }
        }

        await postCard(gig, runner, outcome);
        return outcome;
    }

    const whisperTargets = () => {
        const ids = game.users.filter((u) => u.isGM).map((u) => u.id);
        const own = ownerUser(); if (own && !ids.includes(own.id)) ids.push(own.id);
        return ids;
    };

    async function postCard(gig, runner, o) {
        const rows = o.lines.map((l) => {
            const colour = l.delta > 0 ? ACCENT : l.delta === 0 ? "#cccccc" : (l.delta === FUMBLE ? "#ff3366" : "#ff9900");
            const sign = l.delta > 0 ? `+${l.delta}` : (l.delta === 0 ? "pass" : l.delta);
            return `<div style="display:flex;justify-content:space-between;gap:8px;border-bottom:1px solid #222;padding:3px 0;">
                <span><b>${esc(l.skill)}</b> <span style="opacity:.6">${esc(diffName(l.dv))}</span><br><span style="font-size:.85em;opacity:.7">${esc(l.by)}: ${esc(l.text)}</span></span>
                <span style="color:${colour};white-space:nowrap;">${sign}</span></div>`;
        }).join("");

        const verdict = o.wiped
            ? `<b style="color:#ff3366">Two fumbles. The gig is gone.</b>`
            : (o.success
                ? `<b style="color:${ACCENT}">Success.</b> Rolled ${o.finalRoll} against ${o.chance}.`
                : `<b style="color:#ff3366">Failed.</b> Rolled ${o.finalRoll} against ${o.chance}.`);

        const money = o.success
            ? `<div style="margin-top:6px;">${esc(gig.client)} pays <b>${Number(gig.payout) || 0}eb</b>. ${esc(runner?.name ?? "The runner")} is owed <b>${o.cut}eb</b> at a ${o.fee}% fee, leaving <b>${o.keep}eb</b>.</div>`
            : `<div style="margin-top:6px;opacity:.8">No payout.</div>`;

        const streak = clientStreak(gig.client);
        const dropped = !o.success && streak >= 3
            ? `<div style="margin-top:6px;color:#ff3366;"><b>${esc(gig.client)} has dropped you.</b> Three failures in a row.</div>`
            : (!o.success && streak === 2 ? `<div style="margin-top:6px;color:#ff9900;">Two failures in a row for ${esc(gig.client)}. One more and they walk.</div>` : "");

        await ChatMessage.create({
            whisper: whisperTargets(),
            content: `<div style="font-family: monospace; font-size: 0.8rem; border:1px solid ${ACCENT}; border-radius:6px; padding:10px; background:rgba(0,0,0,.35);">
                <div style="color:${ACCENT}; letter-spacing:2px; margin-bottom:4px;">OPERATOR // GIG REPORT</div>
                <div style="font-size:1rem;color:#fff;"><b>${esc(gig.title)}</b></div>
                <div style="opacity:.7;margin-bottom:8px;">${esc(gig.client)} &middot; ${esc(runner?.name ?? "unassigned")}</div>
                ${rows}
                <div style="margin-top:8px;">${verdict}</div>${money}${dropped}</div>`,
        });
    }

    /** Called when the calendar date moves. Only one GM does the work. */
    async function resolveDue() {
        if (!isActiveGM() || _resolving) return;
        _resolving = true;
        try {
            const due = gigs().filter((g) => g.status === "assigned" && g.due && (daysUntil(g.due) ?? 1) <= 0);
            for (const g of due) await resolveGig(g);
            if (due.length) renderPhone();
        } finally { _resolving = false; }
    }
    let _resolving = false;

    /* ---------------------------------------------------------------- */
    /*  Writes                                                           */
    /*                                                                   */
    /*  Gigs and operators live in world settings, which Foundry only    */
    /*  lets a GM write. The owner is a player, so their actions are     */
    /*  relayed to the active GM over the module's socket.               */
    /* ---------------------------------------------------------------- */

    const SOCKET = `module.${ID}`;

    async function request(payload) {
        if (game.user.isGM) return applyOp({ ...payload, userId: game.user.id });
        if (!activeGM()) return ui.notifications.warn("No GM is connected, so the Operator cannot record that.");
        game.socket.emit(SOCKET, { operator: true, ...payload, userId: game.user.id });
    }

    /** GM side. Every list write lands here, re-reading first so nothing is clobbered. */
    async function applyOp(msg) {
        if (!game.user.isGM) return;
        switch (msg.op) {
            case "assign": {
                const list = gigs();
                const i = list.findIndex((g) => g.id === msg.gigId);
                if (i < 0 || list[i].status !== "open") return;
                const r = runners().find((x) => x.id === msg.runnerId);
                if (!r) return;
                list[i] = { ...list[i], runnerId: msg.runnerId, status: "assigned" };
                await saveGigs(list);
                await ChatMessage.create({ whisper: whisperTargets(), content: `<div style="font-family:monospace;"><b style="color:${ACCENT}">OPERATOR</b><br>${esc(r.name)} took <b>${esc(list[i].title)}</b>. Due ${esc(prettyDate(list[i].due))}.</div>` });
                renderPhone();
                return;
            }
            case "assist": {
                const list = gigs();
                const i = list.findIndex((g) => g.id === msg.gigId);
                if (i < 0 || list[i].assist) return;   // one call per gig, whoever asks first
                list[i] = { ...list[i], assist: { skill: msg.skill, total: msg.total, die: msg.die } };
                await saveGigs(list);
                renderPhone();
                return;
            }
            case "resolve": {
                const g = gigs().find((x) => x.id === msg.gigId);
                if (!g || g.status !== "assigned" || !g.runnerId) return;
                await resolveGig(g);
                renderPhone();
                return;
            }
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Markup                                                           */
    /* ---------------------------------------------------------------- */

    const chip = (text, colour) => `<span style="font-size:.6rem;border:1px solid ${colour};color:${colour};border-radius:3px;padding:1px 5px;white-space:nowrap;">${esc(text)}</span>`;

    const diffColour = (dv) => ({ 13: "#64ffda", 15: "#ffd166", 17: "#ff9900", 21: "#ff3366" }[Number(dv)] ?? "#888");

    function gigCard(g, view) {
        const runner = runners().find((r) => r.id === g.runnerId);
        const open = view.gigId === g.id;
        const days = g.due ? daysUntil(g.due) : null;

        const status = g.status === "done"
            ? chip(g.outcome?.success ? "PAID" : "FAILED", g.outcome?.success ? ACCENT : "#ff3366")
            : (g.status === "assigned"
                ? chip(days === null ? "IN PROGRESS" : (days <= 0 ? "DUE" : `${days}D LEFT`), "#ffd166")
                : chip("AVAILABLE", "#888"));

        const skills = g.skills.map((s) => {
            const covered = runner && usableSkills(runner).some((u) => u.name.trim().toLowerCase() === s.name.trim().toLowerCase());
            const assisted = g.assist && g.assist.skill.trim().toLowerCase() === s.name.trim().toLowerCase();
            const mark = assisted ? "&#9679;" : (covered ? "&#10003;" : "&#10007;");
            const colour = assisted ? "#22ddff" : (covered ? ACCENT : "#ff3366");
            return `<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;padding:2px 0;">
                <span style="color:${colour};">${mark} ${esc(s.name)}</span>${chip(diffName(s.dv), diffColour(s.dv))}</div>`;
        }).join("");

        let body = "";
        if (open) {
            // Who can do this job: every runner scored against this gig's own skills.
            const crew = runners().map((r) => {
                const mine = usableSkills(r).map((u) => u.name.trim().toLowerCase());
                const marks = g.skills.map((s) => mine.includes(s.name.trim().toLowerCase()));
                return { r, marks, hits: marks.filter(Boolean).length };
            }).sort((a, b) => b.hits - a.hits || a.r.name.localeCompare(b.r.name));

            const picker = g.status === "open" && crew.length
                ? `<div style="margin-top:10px;">
                    <div style="font-size:.6rem;opacity:.6;letter-spacing:1px;margin-bottom:4px;">WHO TAKES IT</div>
                    ${crew.map(({ r, marks, hits }) => `
                        <div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-top:1px solid #1b1b1b;">
                            <span style="flex:1;min-width:0;">
                                <span class="op-row-name" style="color:#fff;font-size:.75rem;">${esc(r.name)}</span>
                                <span style="font-size:.6rem;opacity:.55;"> &middot; ${esc(tierOf(r).name)}</span><br>
                                <span style="font-size:.65rem;letter-spacing:2px;">${marks.map((m, i) => `<span title="${esc(g.skills[i].name)}" style="color:${m ? ACCENT : "#ff3366"}">${m ? "&#10003;" : "&#10007;"}</span>`).join("")}</span>
                                <span style="font-size:.6rem;opacity:.55;margin-left:6px;">${hits} of ${g.skills.length}</span>
                            </span>
                            <button type="button" data-action="op-assign" data-gig="${g.id}" data-runner="${r.id}" style="font-family:inherit;background:rgba(158,240,26,.15);border:1px solid ${ACCENT};color:${ACCENT};border-radius:3px;font-size:.65rem;padding:3px 10px;cursor:pointer;">SEND</button>
                        </div>`).join("")}
                   </div>`
                : "";

            const uncovered = runner ? g.skills.filter((s) => !usableSkills(runner).some((u) => u.name.trim().toLowerCase() === s.name.trim().toLowerCase())) : [];
            const assist = (g.status === "assigned" && !g.assist && uncovered.length && !_calling.has(g.id))
                ? `<div style="margin-top:8px;">
                    <div style="font-size:.6rem;opacity:.6;letter-spacing:1px;margin-bottom:3px;">TAKE THE CALL (ONCE PER GIG)</div>
                    ${uncovered.map((s) => `<button type="button" data-action="op-assist" data-gig="${g.id}" data-skill="${esc(s.name)}" style="font-family:inherit;background:rgba(34,221,255,.12);border:1px solid #22ddff;color:#22ddff;border-radius:3px;font-size:.65rem;padding:3px 8px;margin:0 4px 4px 0;cursor:pointer;">${esc(s.name)}</button>`).join("")}
                   </div>`
                : "";

            const assistDone = g.assist
                ? `<div style="margin-top:8px;font-size:.65rem;color:#22ddff;">You covered <b>${esc(g.assist.skill)}</b>.</div>`
                : "";

            const gmTools = canEdit()
                ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;">
                    ${g.status === "open" ? `<button type="button" data-action="op-edit-gig" data-gig="${g.id}" style="font-family:inherit;background:transparent;border:1px solid #4a5a2e;color:#b6c98a;border-radius:3px;font-size:.65rem;padding:3px 8px;cursor:pointer;">EDIT</button>` : ""}
                    ${g.status === "assigned" ? `<button type="button" data-action="op-resolve" data-gig="${g.id}" style="font-family:inherit;background:rgba(158,240,26,.15);border:1px solid ${ACCENT};color:${ACCENT};border-radius:3px;font-size:.65rem;padding:3px 8px;cursor:pointer;">RESOLVE NOW</button>` : ""}
                    <button type="button" data-action="op-delete-gig" data-gig="${g.id}" style="font-family:inherit;background:transparent;border:1px solid #553;color:#997;border-radius:3px;font-size:.65rem;padding:3px 8px;cursor:pointer;">DELETE</button>
                   </div>`
                : "";

            const report = g.outcome
                ? `<div style="margin-top:8px;font-size:.65rem;">${g.outcome.wiped ? "Two fumbles ended it." : `Rolled ${g.outcome.finalRoll} against ${g.outcome.chance}.`}${g.outcome.success ? ` Runner's cut ${g.outcome.cut}eb, yours ${g.outcome.keep}eb.` : ""}</div>`
                : "";

            body = `<div style="border-top:1px solid #222;margin-top:8px;padding-top:8px;">
                ${g.brief ? `<div style="font-size:.7rem;opacity:.85;margin-bottom:8px;">${esc(g.brief)}</div>` : ""}
                ${skills}${picker}${assist}${assistDone}${report}${gmTools}</div>`;
        }

        const spent = g.status === "done" && !open;
        return `<div style="background:rgba(255,255,255,.03);border:1px solid ${open ? ACCENT : "#222"};border-radius:6px;padding:10px;margin-bottom:8px;${spent ? "opacity:.45;" : ""}">
            <div data-action="op-open-gig" data-gig="${g.id}" style="cursor:pointer;display:flex;justify-content:space-between;align-items:flex-start;gap:8px;">
                <span>
                    <span style="color:#fff;font-size:.85rem;font-weight:bold;">${esc(g.title)}</span><br>
                    <span style="font-size:.65rem;opacity:.65;">${esc(g.client)}${runner ? ` &rarr; ${esc(runner.name)}` : ""}</span>
                </span>
                <span style="text-align:right;white-space:nowrap;">
                    <span style="color:#ffd166;font-size:.8rem;">${Number(g.payout) || 0}eb</span><br>${status}
                </span>
            </div>${body}</div>`;
    }

    function crewCard(r) {
        const t = tierOf(r);
        const skills = usableSkills(r);
        const list = skills.length
            ? skills.map((s) => `<div style="display:flex;justify-content:space-between;font-size:.7rem;padding:1px 0;"><span>${esc(s.name)}</span><span style="color:${ACCENT}">${s.total}</span></div>`).join("")
            : `<div style="font-size:.65rem;opacity:.5;">No skills on their sheet.</div>`;

        return `<div style="background:rgba(255,255,255,.03);border:1px solid #222;border-radius:6px;padding:10px;margin-bottom:8px;">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:6px;">
                <img src="${esc(r.img || "icons/svg/mystery-man.svg")}" style="width:34px;height:34px;border-radius:50%;object-fit:cover;border:1px solid ${ACCENT};">
                <span style="flex:1;">
                    <span style="color:#fff;font-size:.85rem;font-weight:bold;">${esc(r.name)}</span><br>
                    <span style="font-size:.6rem;opacity:.65;">${esc(t.name)}</span>
                </span>
                ${canEdit() ? `<button type="button" data-action="op-drop-runner" data-runner="${r.id}" style="font-family:inherit;background:transparent;border:1px solid #553;color:#997;border-radius:3px;font-size:.6rem;padding:2px 6px;cursor:pointer;">DROP</button>` : ""}
            </div>${list}</div>`;
    }

    function html(app) {
        const view = app._operator ?? (app._operator = { tab: "gigs", gigId: null });
        const all = gigs();
        const live = all.filter((g) => g.status !== "done");
        const done = all.filter((g) => g.status === "done").slice(-8).reverse();

        const tab = (id, label, count) => `<button type="button" data-action="op-tab" data-tab="${id}" style="font-family:inherit;flex:1;background:${view.tab === id ? `rgba(158,240,26,.15)` : "transparent"};border:0;border-bottom:2px solid ${view.tab === id ? ACCENT : "#222"};color:${view.tab === id ? ACCENT : "#777"};font-size:.7rem;letter-spacing:1px;padding:8px 0;cursor:pointer;font-family:inherit;">${label}${count ? ` (${count})` : ""}</button>`;

        const bodyGigs = live.length || done.length
            ? live.map((g) => gigCard(g, view)).join("")
                + (done.length ? `<div style="font-size:.6rem;opacity:.45;letter-spacing:1px;margin:12px 0 6px;">CLOSED</div>${done.map((g) => gigCard(g, view)).join("")}` : "")
            : `<div style="text-align:center;opacity:.45;font-size:.7rem;padding:30px 10px;">No gigs on the board.${canEdit() ? " Tap + to post one." : ""}</div>`;

        const crew = runners();
        const bodyCrew = crew.length
            ? crew.map(crewCard).join("")
            : `<div style="text-align:center;opacity:.45;font-size:.7rem;padding:30px 10px;">No operators yet.${canEdit() ? " Tap + to add one." : ""}</div>`;

        return `<div class="app-header drag-handle" style="justify-content:space-between;">
                <span data-action="back-to-home" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                    <i class="fas fa-chevron-left" style="color:${ACCENT};"></i>
                    <h3 style="color:${ACCENT};margin:0;">Operator</h3>
                </span>
                ${canEdit() ? `<button type="button" data-action="${view.tab === "crew" ? "op-new-runner" : "op-new-gig"}" title="${view.tab === "crew" ? "Add an operator" : "Post a gig"}" style="font-family:inherit;background:rgba(158,240,26,.18);border:1px solid ${ACCENT};color:${ACCENT};width:30px;height:30px;border-radius:50%;cursor:pointer;font-size:.9rem;">+</button>` : ""}
            </div>
            <div style="display:flex;flex-shrink:0;">${tab("gigs", "GIGS", live.length)}${tab("crew", "OPERATORS", crew.length)}</div>
            <div style="flex:1;overflow-y:auto;padding:10px;">${view.tab === "crew" ? bodyCrew : bodyGigs}</div>`;
    }

    const tile = () => ({ id: "operator", label: "OPERATOR", icon: "fas fa-headset", color: ACCENT, iconImg: null });

    /* ---------------------------------------------------------------- */
    /*  Dialogs                                                          */
    /* ---------------------------------------------------------------- */

    /** Every skill name known to the world, for the gig form's autocomplete. */
    function skillNames() {
        const names = new Set();
        for (const a of game.actors) for (const s of a.itemTypes?.skill ?? []) names.add(s.name);
        for (const i of game.items) if (i.type === "skill") names.add(i.name);
        return [...names].sort();
    }

    /** Post a new gig, or edit one that nobody has taken yet. */
    function gigDialog(app, existing = null) {
        const list = skillNames();
        const edit = !!existing;
        const rows = Array.from({ length: 5 }, (_, i) => {
            const sk = existing?.skills?.[i];
            return `<div style="display:flex;gap:6px;margin-bottom:4px;">
                <input type="text" name="skill${i}" list="op-skill-list" value="${esc(sk?.name ?? "")}" placeholder="Skill ${i + 1}${i ? " (optional)" : ""}" style="flex:2;">
                <select name="dv${i}" style="font-family:inherit;flex:1;">${DIFF.map((d) => `<option value="${d.dv}"${d.dv === (sk?.dv ?? 15) ? " selected" : ""}>${d.name}</option>`).join("")}</select>
            </div>`;
        }).join("");

        const days = edit ? Math.max(1, daysUntil(existing.due) ?? 7) : 7;
        const fee = edit ? existing.fee : Number(game.settings.get(ID, "operatorFee") ?? 20);

        new Dialog({
            title: edit ? "Edit gig" : "Post a gig",
            content: `<form>
                <datalist id="op-skill-list">${list.map((n) => `<option value="${esc(n)}">`).join("")}</datalist>
                <div class="form-group"><label>Title</label><input type="text" name="title" value="${esc(existing?.title ?? "")}" placeholder="Locker Job"></div>
                <div class="form-group"><label>Client</label><input type="text" name="client" value="${esc(existing?.client ?? "")}" placeholder="Jaxon"></div>
                <div class="form-group"><label>Brief</label><textarea name="brief" rows="2" placeholder="What the client says.">${esc(existing?.brief ?? "")}</textarea></div>
                <div class="form-group"><label>Payout (eb)</label><input type="number" name="payout" value="${Number(existing?.payout ?? 500)}" min="0" step="50"></div>
                <div class="form-group"><label>Days${edit ? " from today" : ""}</label><input type="number" name="days" value="${days}" min="1" step="1"></div>
                <div class="form-group"><label>Your fee (%)</label><input type="number" name="fee" value="${fee}" min="0" max="100" step="5"></div>
                <hr><label style="font-size:.8em;opacity:.7;">Skills, one to five</label>${rows}
            </form>`,
            buttons: {
                post: {
                    label: edit ? "Save" : "Post", callback: async (h) => {
                        const f = h[0].querySelector("form");
                        const skills = [];
                        for (let i = 0; i < 5; i++) {
                            const name = f[`skill${i}`].value.trim();
                            if (name) skills.push({ name, dv: Number(f[`dv${i}`].value) });
                        }
                        if (!skills.length) return ui.notifications.warn("A gig needs at least one skill.");
                        const t = today();
                        if (!t) return ui.notifications.error("The calendar module is not running, so a due date cannot be set.");
                        const client = f.client.value.trim() || "Unknown client";
                        if (!edit && hasDropped(client)) return ui.notifications.warn(`${esc(client)} dropped you after three failures and no longer brings work.`);

                        const fields = {
                            title: f.title.value.trim() || "Untitled gig", client,
                            brief: f.brief.value.trim(), payout: Math.max(0, Number(f.payout.value) || 0),
                            fee: Math.min(100, Math.max(0, Number(f.fee.value) || 0)),
                            skills, due: dateKey(addDays(t, Math.max(1, Number(f.days.value) || 7))),
                        };

                        const all = gigs();
                        if (edit) {
                            const i = all.findIndex((g) => g.id === existing.id);
                            if (i < 0) return ui.notifications.warn("That gig is gone.");
                            if (all[i].status !== "open") return ui.notifications.warn("Somebody has already taken that gig.");
                            all[i] = { ...all[i], ...fields };
                            await saveGigs(all);
                            ui.notifications.info(`Operator: "${esc(fields.title)}" updated.`);
                        } else {
                            await saveGigs([...all, { id: uid(), ...fields, posted: dateKey(t), runnerId: null, assist: null, status: "open", outcome: null }]);
                            ui.notifications.info(`Operator: "${esc(fields.title)}" posted.`);
                        }
                        app?.render(true);
                    },
                },
                cancel: { label: "Cancel" },
            },
            default: "post",
        }, { width: 420 }).render(true);
    }

    function newRunnerDialog(app) {
        const taken = new Set(runners().map((r) => r.actorUuid));
        const choices = game.actors.filter((a) => !taken.has(a.uuid) && ["character", "mook"].includes(a.type))
            .sort((a, b) => a.name.localeCompare(b.name));
        if (!choices.length) return ui.notifications.warn("Every actor is already on the roster.");

        new Dialog({
            title: "Add an operator",
            content: `<form>
                <div class="form-group"><label>Actor</label><select name="uuid">${choices.map((a) => `<option value="${a.uuid}">${esc(a.name)}</option>`).join("")}</select></div>
                <div class="form-group"><label>Tier</label><select name="tier">${TIERS.map((t, i) => `<option value="${i}">${t.name} (${t.skills} skill${t.skills === 1 ? "" : "s"})</option>`).join("")}</select></div>
                <p style="font-size:.8em;opacity:.7;">Their usable skills are the highest on their sheet, as many as the tier allows.</p>
            </form>`,
            buttons: {
                add: {
                    label: "Add", callback: async (h) => {
                        const f = h[0].querySelector("form");
                        const actor = actorOf(f.uuid.value);
                        if (!actor) return ui.notifications.warn("That actor is gone.");
                        const tier = Number(f.tier.value) || 0;
                        await saveRunners([...runners(), { id: uid(), name: actor.name, img: actor.img, actorUuid: actor.uuid, tier, completed: TIERS[tier].gigs }]);
                        await giveContact(actor.name, actor.img);
                        ui.notifications.info(`Operator: ${esc(actor.name)} is now one of your operators.`);
                        app?.render(true);
                    },
                },
                cancel: { label: "Cancel" },
            },
            default: "add",
        }, { width: 380 }).render(true);
    }

    /* ---------------------------------------------------------------- */
    /*  Clicks                                                           */
    /* ---------------------------------------------------------------- */

    /** Gigs with an action in flight, so a second click does nothing. */
    const _calling = new Set();

    async function onClick(app, action, ev) {
        const view = app._operator ?? (app._operator = { tab: "gigs", gigId: null });
        const $t = $(ev.currentTarget);
        const gigId = $t.data("gig");

        try {
            switch (action) {
                case "op-tab":
                    view.tab = $t.data("tab"); view.gigId = null; app.render(true); break;

                case "op-open-gig":
                    view.gigId = view.gigId === gigId ? null : gigId; app.render(true); break;

                case "op-new-gig":
                    if (canEdit()) gigDialog(app); break;

                case "op-edit-gig": {
                    if (!canEdit()) break;
                    const g = gigs().find((x) => x.id === gigId);
                    if (!g) break;
                    if (g.status !== "open") { ui.notifications.warn("That gig has already been taken."); break; }
                    gigDialog(app, g); break;
                }

                case "op-new-runner":
                    if (canEdit()) newRunnerDialog(app); break;

                case "op-delete-gig": {
                    if (!canEdit()) break;
                    if (!await Dialog.confirm({ title: "Delete gig", content: "<p>Remove this gig from the board?</p>" })) break;
                    await saveGigs(gigs().filter((g) => g.id !== gigId));
                    view.gigId = null; app.render(true); break;
                }

                case "op-drop-runner": {
                    if (!canEdit()) break;
                    const id = $t.data("runner");
                    if (!await Dialog.confirm({ title: "Drop operator", content: "<p>Drop this operator? Their gig history goes with them.</p>" })) break;
                    await saveRunners(runners().filter((r) => r.id !== id));
                    app.render(true); break;
                }

                case "op-assign":
                    await request({ op: "assign", gigId, runnerId: $t.data("runner") });
                    break;

                case "op-assist": {
                    const skill = String($t.data("skill"));
                    const g = gigs().find((x) => x.id === gigId);
                    if (!g || g.assist || _calling.has(gigId)) break;
                    const actor = ownerActor();
                    if (!actor) { ui.notifications.warn("No character is assigned to the Operator, so there is nothing to roll."); break; }
                    _calling.add(gigId);                      // the button cannot be pressed twice while this lands
                    try {
                        app.render(true);
                        const total = skillTotal(actor, skill);
                        const roll = await new Roll("1d10").evaluate();
                        await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor: `Operator assist: ${esc(skill)}` });
                        await request({ op: "assist", gigId, skill, total, die: roll.total });
                        ui.notifications.info(`Operator: you covered ${esc(skill)}. That roll stands when the gig resolves.`);
                    } finally { _calling.delete(gigId); }
                    break;
                }

                case "op-resolve": {
                    if (!canEdit() || _calling.has(gigId)) break;
                    const g = gigs().find((x) => x.id === gigId);
                    if (!g) break;
                    if (!g.runnerId) { ui.notifications.warn("Nobody is on that gig."); break; }
                    _calling.add(gigId);                      // a double click must not resolve it twice
                    try { await request({ op: "resolve", gigId }); } finally { _calling.delete(gigId); }
                    break;
                }
            }
        } catch (err) {
            console.error("Operator |", err);
            ui.notifications.error(`Operator: ${err.message}`);
        }
    }

    /* ---------------------------------------------------------------- */
    /*  Wiring                                                           */
    /* ---------------------------------------------------------------- */

    globalThis.VirtualAgentOperator = { html, onClick, visible, tile, resolveDue };

    Hooks.once("init", () => {
        game.settings.register(ID, "operatorOwner", {
            name: "Operator app owner",
            hint: "The player whose Agent carries the Operator app, and whose character rolls when they take a call. The GM always has it.",
            scope: "world", config: true, type: String, default: "",
            choices: { "": "GM only" },            // filled with the player list at ready; users do not exist yet at init
            onChange: () => renderPhone(),
        });
        game.settings.register(ID, "operatorFee", {
            name: "Operator default fee (%)",
            hint: "The cut the Operator keeps of a gig's payout by default. Set per gig when posting.",
            scope: "world", config: true, type: Number, default: 20,
        });
        game.settings.register(ID, "operatorGigs", { scope: "world", config: false, type: String, default: "[]", onChange: () => renderPhone() });
        game.settings.register(ID, "operatorRunners", { scope: "world", config: false, type: String, default: "[]", onChange: () => renderPhone() });
        game.settings.register(ID, "operatorDropped", { scope: "world", config: false, type: String, default: "[]" });
    });

    Hooks.on("nunuCalendar.dateChanged", () => { resolveDue().catch(console.error); });

    Hooks.once("ready", () => {
        // A player's actions arrive here; the upstream listener keys off `action`, so the two do not collide.
        game.socket.on(SOCKET, (msg) => {
            if (!msg?.operator || !isActiveGM()) return;
            applyOp(msg).catch((e) => { console.error("Operator |", e); ui.notifications.error(`Operator: ${e.message}`); });
        });

        // The player list only exists now, so the owner setting gets its dropdown here.
        const setting = game.settings.settings.get(`${ID}.operatorOwner`);
        if (setting) {
            setting.choices = {
                "": "GM only",
                ...Object.fromEntries(game.users.filter((u) => !u.isGM)
                    .map((u) => [u.id, u.character ? `${u.name} (${u.character.name})` : u.name])),
            };
        }

        resolveDue().catch(console.error);
        // Operators added before this version never got a contact; give them one now.
        if (game.user.isGM) for (const r of runners()) giveContact(r.name, r.img).catch(console.error);
    });
})();
