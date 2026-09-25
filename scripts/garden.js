/* ------------------------------------------------------------------ *
 *  NuNu packaging: the Garden.
 *
 *  Upstream ships the Garden as a dating app. In this campaign it is
 *  what it is in the fiction: the Data Pool's social network, where a
 *  credentialed Media publishes and the city answers back.
 *
 *  The Media writes a headline. That is the whole post: what she chose
 *  to say is the input, and the comments underneath are the output.
 *  Some comments are written in code, meant for her and nobody else.
 *  Everyone can see that a coded comment exists and read its text; only
 *  she can Decipher it, and a failed attempt waits out the day.
 *
 *  Posts live in one world setting. Only a GM can write a world
 *  setting, so every change is relayed to the GM as a small targeted
 *  operation and the GM re-reads before applying it. Relaying the whole
 *  array instead would mean the last writer silently erased the other.
 * ------------------------------------------------------------------ */

(() => {
    const ID = "VirtualAgent";
    const ACCENT = "#ff1493";

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const uid = () => foundry.utils.randomID();
    const num = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.floor(Number(v) || 0)));
    const commas = (n) => Number(n || 0).toLocaleString();

    const calendar = () => game.modules.get("nunu-calendar")?.api ?? null;
    const dateKey = (d) => d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : "";

    /** A real-world day, tagged so it can never be mistaken for an in-game date. */
    const realKey = () => { const n = new Date(); return `real:${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, "0")}-${String(n.getDate()).padStart(2, "0")}`; };

    /** Today. The in-game date when the calendar is running, otherwise the real one, so
        "a failed attempt waits out the day" still means something with the calendar off. */
    const today = () => dateKey(calendar()?.getDate?.()) || realKey();

    const isGameDay = (k) => typeof k === "string" && /^\d{4}-\d{2}-\d{2}$/.test(k);

    const prettyDate = (k) => {
        if (!isGameDay(k)) return "";
        const cal = calendar(); if (!cal) return k;
        const [y, m, d] = k.split("-").map(Number);
        return cal.shortDate ? cal.shortDate({ y, m, d }) : k;
    };

    const posts = () => {
        try { const raw = game.settings.get(ID, "gardenPosts"); const v = typeof raw === "string" ? JSON.parse(raw || "[]") : raw; return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
    };
    const savePosts = (v) => game.settings.set(ID, "gardenPosts", JSON.stringify(v));
    const redraw = () => { const a = globalThis.AgentDeviceApp?.ui; if (a?.rendered) a.render(true); };

    /* ---------------------------------------------------------------- */
    /*  Who publishes                                                    */
    /* ---------------------------------------------------------------- */

    const actorOf = (u) => {
        try {
            const uuid = u?.getFlag?.(ID, "lastActorUuid");
            const a = uuid ? fromUuidSync(uuid) : null;
            if (a?.documentName === "Actor") return a;
        } catch (e) { /* a stale uuid is not worth an error */ }
        return u?.character ?? null;
    };
    const roleOf = (a) => (a?.itemTypes?.role ?? [])[0]?.name || "";
    /** A credentialed Media, by their Role. Nothing to configure. */
    const isMedia = (u) => roleOf(actorOf(u)) === "Media";
    const canPublish = () => isMedia(game.user);
    const mediaUser = () => game.users.find((u) => !u.isGM && isMedia(u)) ?? null;

    /** Her own Credibility Rank, off the Media role item on the sheet. */
    const credibility = (actor) => num((actor?.itemTypes?.role ?? [])[0]?.system?.rank, 0, 10);

    /** The post is hers when her user id is on it. Posts written before this was recorded
        fall back to "any credentialed Media", which is how they already behaved. */
    const isAuthor = (post) => post?.authorUserId ? post.authorUserId === game.user.id : canPublish();

    /* ---------------------------------------------------------------- */
    /*  The Hyph Squad                                                   */
    /*                                                                   */
    /*  Followers live on the character sheet, so they survive anything  */
    /*  that happens to the world settings and the GM can edit them.     */
    /* ---------------------------------------------------------------- */

    const followers = (actor) => num(actor?.getFlag?.(ID, "gardenFollowers"), 0, 1e12);

    /** Whose following the header shows: her own to her, hers to everybody else. */
    const squadActor = () => (canPublish() ? actorOf(game.user) : actorOf(mediaUser()));

    /** A story the city believes brings in 1d10 x 10 x Credibility Rank cubed. The ladder
        runs from one neighborhood to the whole world, so the gain climbs that steeply too. */
    async function gainFollowers(actor, rank) {
        if (!actor || rank < 1) return 0;
        const roll = await new Roll("1d10").evaluate();
        const gained = roll.total * 10 * rank * rank * rank;
        const next = followers(actor) + gained;
        try { await actor.setFlag(ID, "gardenFollowers", next); }
        catch (e) { await request({ op: "setFollowers", actorUuid: actor.uuid, value: next }); }
        return gained;
    }

    /* ---------------------------------------------------------------- */
    /*  One story a week                                                 */
    /* ---------------------------------------------------------------- */

    /** Days between an in-game date key and today, or null when either is not an in-game date. */
    const daysSince = (k) => {
        const t = calendar()?.getDate?.();
        if (!t || !isGameDay(k)) return null;
        const [y, m, d] = k.split("-").map(Number);
        return Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(y, m - 1, d)) / 86400000);
    };

    /** The city will carry one story a week. Anything more and none of them land.
        Keyed on the user rather than the character's name, so renaming the character or
        opening the Agent as somebody else does not hand her a second story. */
    function nextPublishIn() {
        const me = game.user.id;
        const fallbackName = actorOf(game.user)?.name || game.user.name;
        const mine = posts().filter((p) => (p.authorUserId ? p.authorUserId === me : p.authorName === fallbackName));
        // The newest story that carries a real in-game date is what the clock runs from.
        // One published with the calendar off has no date and cannot start it.
        for (let i = mine.length - 1; i >= 0; i--) {
            const since = daysSince(mine[i].posted);
            if (since !== null) return num(7 - since, 0, 7);
        }
        return 0;
    }

    /* ---------------------------------------------------------------- */
    /*  Deciphering                                                      */
    /* ---------------------------------------------------------------- */

    const skillTotal = (actor, name) => {
        if (!actor) return 0;
        const key = String(name).trim().toLowerCase();
        const item = (actor.itemTypes?.skill ?? []).find((s) => s.name.trim().toLowerCase() === key);
        if (!item) return 0;
        return (actor.system?.stats?.[item.system?.stat]?.value ?? 0) + (item.system?.level ?? 0);
    };

    /** True when a failed attempt has not yet waited out the day. */
    const lockedToday = (comment) => !!comment.failedOn && comment.failedOn === today();

    /** Rolls in flight, so a second click cannot spend a second d10 on the same thing. */
    const busy = new Set();

    async function decipher(postId, commentId) {
        const tag = `d:${postId}:${commentId}`;
        if (busy.has(tag)) return;

        const actor = actorOf(game.user);
        if (!actor) return ui.notifications.warn("No character is assigned, so there is nothing to roll.");

        const post = posts().find((p) => p.id === postId);
        const comment = post?.comments?.find((c) => c.id === commentId);
        if (!comment || comment.deciphered) return;
        if (!isAuthor(post)) return;
        if (lockedToday(comment)) return ui.notifications.warn("You have already worked at this one today. Try again tomorrow.");
        // The result has to be recordable before the die is spent, or a failed attempt is
        // announced to the table and then forgotten, and she can simply try again.
        if (!game.user.isGM && !activeGM()) return ui.notifications.warn("No GM is connected, so the attempt cannot be recorded. Try when one is.");

        busy.add(tag);
        try {
            const total = skillTotal(actor, "Deduction");
            const roll = await new Roll("1d10").evaluate();
            const sum = roll.total + total;
            const dv = num(comment.dv, 1, 30) || 15;
            const beat = sum >= dv;

            await roll.toMessage({
                speaker: ChatMessage.getSpeaker({ actor }),
                whisper: [game.user.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
                flavor: `Deciphering a comment on &ldquo;${esc(post.headline)}&rdquo; &middot; Deduction ${total} + ${roll.total} = ${sum}`,
            });

            await request({ op: "decipher", postId, commentId, won: beat, failedOn: beat ? "" : today() });

            ui.notifications[beat ? "info" : "warn"](beat
                ? "You read what they were actually saying."
                : "It does not come apart. Sleep on it.");
        } finally { busy.delete(tag); }
    }

    /* ---------------------------------------------------------------- */
    /*  Writes                                                           */
    /* ---------------------------------------------------------------- */

    const SOCKET = `module.${ID}`;
    const activeGM = () => game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
    const isActiveGM = () => activeGM()?.id === game.user.id;

    async function request(payload) {
        if (game.user.isGM) return apply({ ...payload, userId: game.user.id });
        if (!activeGM()) { ui.notifications.warn("No GM is connected, so the Garden cannot record that."); return false; }
        game.socket.emit(SOCKET, { garden: true, ...payload, userId: game.user.id });
        return true;
    }

    /* Everything that arrives here is shaped by a client, so every field is coerced to
       the type and range it is supposed to have before it is stored. */
    const str = (v, max) => String(v ?? "").slice(0, max);

    const sanePost = (p) => ({
        id: str(p?.id, 40) || uid(),
        headline: str(p?.headline, 300),
        authorName: str(p?.authorName, 120),
        authorUserId: str(p?.authorUserId, 40),
        credibility: num(p?.credibility, 0, 10),
        posted: str(p?.posted, 24),
        evidence: {
            simple: str(p?.evidence?.simple, 400),
            hard: Array.isArray(p?.evidence?.hard) ? p.evidence.hard.slice(0, 10).map((e) => str(e, 400)) : [],
        },
        bonus: num(p?.bonus, 0, 3),
        believed: null,
        comments: [],
    });

    const saneComment = (c) => ({
        id: str(c?.id, 40) || uid(),
        who: str(c?.who, 60) || "anon",
        text: str(c?.text, 2000),
        coded: !!c?.coded,
        intent: str(c?.intent, 2000),
        dv: num(c?.dv, 1, 30) || 15,
        deciphered: false,
        failedOn: "",
    });

    /** The GM's side. Re-reads the stored list every time, so two people working at once
        cannot stamp over each other's work the way a whole-array write would. */
    async function apply(msg) {
        if (!game.user.isGM) return false;
        const list = posts();
        let changed = false;

        const findPost = () => list.findIndex((p) => p.id === msg.postId);

        switch (msg.op) {
            case "addPost": {
                const post = sanePost(msg.post);
                if (!list.some((p) => p.id === post.id)) { list.push(post); changed = true; }
                break;
            }
            case "believed": {
                const i = findPost();
                if (i >= 0 && list[i].believed == null) {
                    list[i] = { ...list[i], believed: !!msg.believed, rolled: num(msg.rolled, 0, 10), target: num(msg.target, 0, 10), gained: num(msg.gained, 0, 1e9) };
                    changed = true;
                }
                break;
            }
            case "decipher": {
                const i = findPost();
                const comments = i < 0 ? [] : (list[i].comments || []);
                const j = comments.findIndex((c) => c.id === msg.commentId);
                if (j >= 0 && !comments[j].deciphered) {
                    const next = [...comments];
                    next[j] = msg.won ? { ...next[j], deciphered: true, failedOn: "" } : { ...next[j], failedOn: str(msg.failedOn, 24) };
                    list[i] = { ...list[i], comments: next };
                    changed = true;
                }
                break;
            }
            case "addComment": {
                const i = findPost();
                if (i >= 0 && (list[i].comments || []).length >= MAX_COMMENTS) break;
                if (i >= 0) { list[i] = { ...list[i], comments: [...(list[i].comments || []), saneComment(msg.comment)] }; changed = true; }
                break;
            }
            case "setFollowers": {
                // Not a post change, but it travels the same road so a player's roll can
                // record its gain even when the sheet is not theirs to write.
                const actor = await fromUuid(str(msg.actorUuid, 120)).catch(() => null);
                if (actor?.documentName === "Actor") await actor.setFlag(ID, "gardenFollowers", num(msg.value, 0, 1e12));
                break;
            }
            case "dropPost": {
                const i = findPost();
                if (i >= 0) { list.splice(i, 1); changed = true; }
                break;
            }
            case "dropComment": {
                const i = findPost();
                if (i >= 0) { list[i] = { ...list[i], comments: (list[i].comments || []).filter((c) => c.id !== msg.commentId) }; changed = true; }
                break;
            }
        }

        if (changed) await savePosts(list);
        redraw();
        return changed;
    }

    /* ---------------------------------------------------------------- */
    /*  Publishing                                                       */
    /* ---------------------------------------------------------------- */

    async function publish(headline, evidence) {
        const actor = actorOf(game.user);
        const post = sanePost({
            id: uid(),
            headline,
            authorName: actor?.name || game.user.name,
            authorUserId: game.user.id,
            credibility: credibility(actor),
            posted: today(),
            evidence,
            bonus: (evidence.simple ? 1 : 0) + (evidence.hard.length ? 2 : 0),
        });

        if (!await request({ op: "addPost", post })) return null;

        const backing = [
            post.evidence.simple ? `<br>Plain evidence: ${esc(post.evidence.simple)}` : "",
            post.evidence.hard.length ? `<br>Hard evidence:<br>${post.evidence.hard.map((e, i) => `&nbsp;${i + 1}. ${esc(e)}`).join("<br>")}` : "",
        ].join("");

        await ChatMessage.create({
            whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
            content: `<div style="font-family: monospace; font-size: .8rem; border-left: 3px solid ${ACCENT}; padding-left: 8px;">
                <span style="color:${ACCENT}; letter-spacing:2px;">THE GARDEN</span><br>
                <b>${esc(post.authorName)}</b> published: &ldquo;${esc(post.headline)}&rdquo;
                ${backing || "<br>Nothing the public can check."}</div>`,
        });
        await believability(post.id);
        return post.id;
    }

    /** Believability: a flat d10 at or under the threshold for her Credibility Rank. */
    const BELIEVABILITY = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 6, 10: 7 };

    async function believability(postId) {
        if (busy.has(postId)) return;

        const actor = actorOf(game.user);

        // A player's publish goes to the GM over the socket, so the world setting can be
        // a moment behind the click. Wait for the story to land rather than roll on nothing.
        let post = posts().find((p) => p.id === postId);
        for (let n = 0; !post && n < 20; n++) {
            await new Promise((r) => setTimeout(r, 100));
            post = posts().find((p) => p.id === postId);
        }
        if (!post) return ui.notifications.warn("The story has not finished going up. Use the Roll button on the post.");
        if (post.believed != null) return;
        if (!isAuthor(post) && !game.user.isGM) return;
        if (!game.user.isGM && !activeGM()) return ui.notifications.warn("No GM is connected, so the roll cannot be recorded. Try when one is.");

        busy.add(postId);
        try {
            // The rank frozen onto the story when it went up, so ranking up afterwards does
            // not change how the city received something already published.
            const rank = num(post.credibility, 0, 10) || credibility(actor);
            const base = BELIEVABILITY[rank] ?? 2;
            const target = num(base + num(post.bonus, 0, 3), 0, 10);
            const roll = await new Roll("1d10").evaluate();
            const believed = roll.total <= target;

            const gained = believed ? await gainFollowers(actor, rank) : 0;
            const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);

            // What she is told: whether it landed, and what it brought in. No dice.
            await ChatMessage.create({
                whisper: [...gmIds, game.user.id],
                content: `<div style="font-family: monospace; font-size:.8rem; border-left:3px solid ${ACCENT}; padding-left:8px;">
                    <span style="color:${ACCENT}; letter-spacing:2px;">THE GARDEN</span><br>
                    &ldquo;${esc(post.headline)}&rdquo;<br>
                    ${believed
                        ? `<b style="color:#64ffda;">The city believes it.</b>`
                        : `<b style="color:#ff3366;">The city does not buy it.</b>`}
                    ${gained ? `<br><b>${esc(actor?.name || game.user.name)}</b>'s following grows to <b style="color:#64ffda;">${commas(followers(actor))}</b>.` : ""}</div>`,
            });

            // What you are told: the arithmetic behind it.
            if (gmIds.length) await ChatMessage.create({
                whisper: gmIds,
                content: `<div style="font-family:monospace;font-size:.72rem;color:#8b9183;border-left:3px solid #3a3f36;padding-left:8px;">
                    Believability &middot; Rank ${rank} is ${base} in 10${post.bonus ? `, +${post.bonus} for evidence, so ${target} in 10` : ""}.
                    Rolled <b>${roll.total}</b>, so it ${believed ? "lands" : "does not"}.${gained ? ` Followers +${commas(gained)}.` : ""}</div>`,
            });

            await request({ op: "believed", postId, believed, rolled: roll.total, target, gained });
            return believed;
        } finally { busy.delete(postId); }
    }

    /* ---------------------------------------------------------------- */
    /*  Markup                                                           */
    /* ---------------------------------------------------------------- */

    function commentRow(post, c, mine, raw) {
        const coded = c.coded && !c.deciphered;
        const locked = lockedToday(c);
        // Once she has cracked it she reads the meaning by default, and can flip back to
        // what the commenter actually wrote.
        const showingRaw = raw.has(c.id);
        const body = c.deciphered
            ? (showingRaw
                ? `<div style="font-size:.7rem;color:#b9a7c4;white-space:pre-wrap;font-family:monospace;letter-spacing:.5px;">${esc(c.text)}</div>`
                : `<div style="padding:6px 8px;border-left:2px solid ${ACCENT};background:rgba(255,20,147,.07);font-size:.7rem;color:#fff;white-space:pre-wrap;">${esc(c.intent)}</div>`)
            : `<div style="font-size:.7rem;color:${coded ? "#b9a7c4" : "#ddd"};white-space:pre-wrap;${coded ? "font-family:monospace;letter-spacing:.5px;" : ""}">${esc(c.text)}</div>`;

        const tag = coded
            ? `<span style="font-size:.5rem;border:1px solid #9b6dff;color:#9b6dff;border-radius:3px;padding:0 5px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;">coded</span>`
            : (c.deciphered ? `<span style="font-size:.5rem;border:1px solid ${ACCENT};color:${ACCENT};border-radius:3px;padding:0 5px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;">read</span>` : "");

        const chip = (label, action, disabled, tone) =>
            `<button type="button" data-action="${action}" data-post="${esc(post.id)}" data-comment="${esc(c.id)}" ${disabled ? "disabled" : ""}
               style="font-family:inherit;margin-top:6px;background:${disabled ? "transparent" : tone.bg};border:1px solid ${disabled ? "#463a5c" : tone.line};color:${disabled ? "#6c6280" : tone.ink};border-radius:3px;font-size:.65rem;padding:3px 10px;cursor:${disabled ? "default" : "pointer"};">${label}</button>`;

        const PURPLE = { bg: "rgba(155,109,255,.15)", line: "#9b6dff", ink: "#9b6dff" };
        const QUIET = { bg: "transparent", line: "#3a3f36", ink: "#8b9183" };

        const button = !mine ? ""
            : coded ? chip(locked ? "Nothing more today" : "Decipher", "gd-decipher", locked, PURPLE)
            : c.deciphered ? chip(showingRaw ? "Show what it means" : "Show what they wrote", "gd-toggle", false, QUIET)
            : "";

        const gm = game.user.isGM
            ? `<button type="button" data-action="gd-drop-comment" data-post="${esc(post.id)}" data-comment="${esc(c.id)}" title="Delete"
                 style="font-family:inherit;background:transparent;border:0;color:#5a5f54;font-size:.65rem;cursor:pointer;padding:0 0 0 6px;">&times;</button>`
            : "";

        return `<div style="border-top:1px solid #1e1e22;padding:7px 0;">
            <div style="display:flex;align-items:baseline;gap:6px;">
                <span style="font-size:.65rem;color:#8ab4ff;">${esc(c.who || "anon")}</span>${tag}${gm}
            </div>
            ${body}${button}</div>`;
    }

    function postCard(post, view) {
        const open = view.postId === post.id;
        const mine = isAuthor(post);
        const comments = post.comments || [];
        const unread = comments.filter((c) => c.coded && !c.deciphered).length;
        const when = prettyDate(post.posted);

        const head = `<div data-action="gd-open" data-post="${esc(post.id)}" style="cursor:pointer;">
            <div style="color:#fff;font-size:.9rem;font-weight:700;line-height:1.3;">${esc(post.headline)}</div>
            <div style="font-size:.6rem;color:#7f8a99;margin-top:3px;">
                ${esc(post.authorName)}${when ? ` &middot; ${esc(when)}` : ""}
                &middot; ${comments.length} comment${comments.length === 1 ? "" : "s"}
                ${unread && mine ? ` &middot; <span style="color:#9b6dff;">${unread} in code</span>` : ""}
            </div></div>`;

        if (!open) return `<div style="background:rgba(255,255,255,.03);border:1px solid #222;border-radius:6px;padding:10px;margin-bottom:8px;">${head}</div>`;

        const rows = comments.length
            ? comments.map((c) => commentRow(post, c, mine, view.raw ?? new Set())).join("")
            : `<div style="font-size:.65rem;color:#5a5f54;padding:10px 0;">Nobody has said anything yet.</div>`;

        const bel = post.believed == null
            ? (game.user.isGM ? `<div style="margin-top:9px;"><button type="button" data-action="gd-roll" data-post="${esc(post.id)}" style="font-family:inherit;width:100%;background:rgba(255,20,147,.14);border:1px solid ${ACCENT};color:${ACCENT};border-radius:3px;font-size:.68rem;padding:6px;cursor:pointer;letter-spacing:.08em;text-transform:uppercase;">Believability was never rolled. Roll it.</button></div>`
                   : "")
            : `<div style="margin-top:9px;font-size:.62rem;color:${post.believed ? "#64ffda" : "#ff3366"};letter-spacing:.06em;text-transform:uppercase;">
                ${post.believed ? "The city believes it" : "The city does not buy it"}
                <span style="color:#5a5f54;text-transform:none;letter-spacing:0;">
                    ${Number.isFinite(Number(post.rolled)) && Number.isFinite(Number(post.target)) ? ` &middot; rolled ${esc(post.rolled)} against ${esc(post.target)}` : ""}
                    ${post.gained ? ` &middot; +${esc(commas(post.gained))} followers` : ""}</span></div>`;

        const gmTools = game.user.isGM
            ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                <button type="button" data-action="gd-add-comment" data-post="${esc(post.id)}" ${comments.length >= MAX_COMMENTS ? "disabled" : ""} style="font-family:inherit;background:${comments.length >= MAX_COMMENTS ? "transparent" : "rgba(255,20,147,.14)"};border:1px solid ${comments.length >= MAX_COMMENTS ? "#553" : ACCENT};color:${comments.length >= MAX_COMMENTS ? "#775" : ACCENT};border-radius:3px;font-size:.65rem;padding:3px 9px;cursor:${comments.length >= MAX_COMMENTS ? "default" : "pointer"};">${comments.length >= MAX_COMMENTS ? `${MAX_COMMENTS} comments, the most a story gets` : "Add comment"}</button>
                <button type="button" data-action="gd-drop-post" data-post="${esc(post.id)}" style="font-family:inherit;background:transparent;border:1px solid #553;color:#997;border-radius:3px;font-size:.65rem;padding:3px 9px;cursor:pointer;">Delete post</button>
               </div>`
            : "";

        return `<div style="background:rgba(255,255,255,.03);border:1px solid ${ACCENT};border-radius:6px;padding:10px;margin-bottom:8px;">
            ${head}${bel}<div style="margin-top:8px;">${rows}</div>${gmTools}</div>`;
    }

    function html(app) {
        const view = app._garden ?? (app._garden = { postId: null, raw: new Set() });
        const list = posts().slice().reverse();
        const wait = canPublish() ? nextPublishIn() : 0;

        const body = list.length
            ? list.map((p) => postCard(p, view)).join("")
            : `<div style="text-align:center;color:#5a5f54;font-size:.7rem;padding:34px 12px;">Nothing published yet.${canPublish() ? " Tap + to post a story." : ""}</div>`;

        const squad = squadActor();
        const count = squad ? followers(squad) : 0;
        const squadLine = squad
            ? `<div style="font-size:.58rem;color:#7f8a99;letter-spacing:.04em;margin-top:1px;">
                 <b style="color:${ACCENT};">${esc(commas(count))}</b> followers
                 ${game.user.isGM ? `<button type="button" data-action="gd-followers" title="Set the follower count" style="font-family:inherit;background:transparent;border:0;color:#5a5f54;font-size:.58rem;cursor:pointer;padding:0 0 0 4px;">edit</button>` : ""}
               </div>`
            : "";

        return `<div class="app-header drag-handle" style="justify-content:space-between;">
                <span data-action="back-to-home" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                    <i class="fas fa-chevron-left" style="color:${ACCENT};"></i>
                    <span style="display:flex;flex-direction:column;line-height:1.15;">
                        <h3 style="color:${ACCENT};margin:0;">The Garden</h3>
                        ${squadLine}
                    </span>
                </span>
                ${canPublish() ? `<button type="button" data-action="gd-new" title="${wait ? `The city is still carrying your last story. ${wait} day${wait === 1 ? "" : "s"} to go.` : "Post a story"}" ${wait ? "disabled" : ""} style="font-family:inherit;background:rgba(255,20,147,.18);border:1px solid ${ACCENT};color:${ACCENT};width:30px;height:30px;border-radius:50%;cursor:${wait ? "default" : "pointer"};font-size:.9rem;opacity:${wait ? ".4" : "1"};">+</button>` : ""}
            </div>
            <div style="flex:1;overflow-y:auto;padding:10px;">${body}</div>`;
    }

    /* ---------------------------------------------------------------- */
    /*  Dialogs                                                          */
    /* ---------------------------------------------------------------- */

    /** The city answers a story twice and then moves on. */
    const MAX_COMMENTS = 2;

    /** The book asks for "more than 4 distinct pieces", so the hard-evidence box wants five. */
    const HARD_PIECES = 5;
    const EMPTY_DRAFT = { headline: "", simpleOn: false, simple: "", hardOn: false, hard: [] };

    /** Foundry closes a dialog as soon as a button is pressed, so a rejected form is
        re-opened with everything still in it rather than thrown away. */
    function headlineDialog(app, draft = EMPTY_DRAFT) {
        const reject = (msg, next) => { ui.notifications.warn(msg); setTimeout(() => headlineDialog(app, next), 0); };

        const rows = Array.from({ length: HARD_PIECES }, (_, i) =>
            `<input type="text" name="hard${i}" value="${esc(draft.hard?.[i] ?? "")}" placeholder="Piece ${i + 1}" style="margin-top:3px;">`).join("");

        new Dialog({
            title: "Post a story",
            content: `<form>
                <div class="form-group"><label>Headline</label><input type="text" name="headline" value="${esc(draft.headline)}" placeholder="What you are telling the city."></div>

                <div class="form-group" style="display:block;">
                    <label><input type="checkbox" name="simpleOn" ${draft.simpleOn ? "checked" : ""}> Verifiable Evidence (Simple) <b>+1</b></label>
                    <div data-group="simple" style="display:${draft.simpleOn ? "block" : "none"};margin-top:4px;">
                        <input type="text" name="simple" value="${esc(draft.simple)}" placeholder="What it is">
                    </div>
                </div>

                <div class="form-group" style="display:block;">
                    <label><input type="checkbox" name="hardOn" ${draft.hardOn ? "checked" : ""}> Verifiable Evidence <b>+2</b></label>
                    <div data-group="hard" style="display:${draft.hardOn ? "block" : "none"};margin-top:4px;">${rows}</div>
                </div>

            </form>`,
            buttons: {
                post: { label: "Publish", callback: async (h) => {
                    const f = h[0].querySelector("form");
                    const kept = {
                        headline: f.headline.value.trim(),
                        simpleOn: f.simpleOn.checked,
                        simple: f.simple.value.trim(),
                        hardOn: f.hardOn.checked,
                        hard: Array.from({ length: HARD_PIECES }, (_, i) => f[`hard${i}`].value.trim()),
                    };

                    if (!kept.headline) return reject("A headline is the post; there has to be one.", kept);
                    if (kept.simpleOn && !kept.simple) return reject("Say what the simple piece of evidence is, or untick that box.", kept);
                    if (kept.hardOn && kept.hard.some((v) => !v)) return reject(`All ${HARD_PIECES} pieces have to be filled in, or untick that box.`, kept);

                    const postId = await publish(kept.headline, {
                        simple: kept.simpleOn ? kept.simple : "",
                        hard: kept.hardOn ? kept.hard : [],
                    });
                    app?.render(true);
                } },
                cancel: { label: "Cancel" },
            },
            default: "post",
            render: (h) => {
                const f = h[0].querySelector("form");
                const bind = (box, group) => {
                    const el = f.querySelector(`[data-group="${group}"]`);
                    f[box].addEventListener("change", () => { el.style.display = f[box].checked ? "block" : "none"; });
                };
                bind("simpleOn", "simple");
                bind("hardOn", "hard");
            },
        }, { width: 460 }).render(true);
    }

    function commentDialog(app, postId) {
        const reject = (msg) => ui.notifications.warn(msg);
        new Dialog({
            title: "Add a comment",
            content: `<form>
                <div class="form-group"><label>Handle</label><input type="text" name="who" placeholder="anon"></div>
                <div class="form-group"><label>Comment</label><textarea name="text" rows="3" placeholder="What they wrote, in the clear or in code."></textarea></div>
                <hr>
                <div class="form-group"><label><input type="checkbox" name="coded"> Written in code</label></div>
                <div class="form-group"><label>What it actually says</label><textarea name="intent" rows="2" placeholder="Revealed on a successful Decipher."></textarea></div>
                <div class="form-group"><label>Decipher DV</label><input type="number" name="dv" value="15" min="1" step="1"></div>
            </form>`,
            buttons: {
                add: { label: "Add", callback: async (h) => {
                    const f = h[0].querySelector("form");
                    const text = f.text.value.trim();
                    if (!text) return reject("The comment needs something in it.");

                    const post = posts().find((p) => p.id === postId);
                    if (!post) return reject("That story is no longer there.");
                    if ((post.comments || []).length >= MAX_COMMENTS) return reject(`A story gets ${MAX_COMMENTS} comments and no more.`);

                    await request({ op: "addComment", postId, comment: {
                        id: uid(), who: f.who.value.trim(), text,
                        coded: f.coded.checked, intent: f.intent.value.trim(), dv: f.dv.value,
                    } });

                    // The Media hears the city answer even with the phone shut.
                    const who = mediaUser();
                    if (who) await ChatMessage.create({
                        whisper: [who.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
                        content: `<div style="font-family: monospace; font-size:.8rem; border-left:3px solid ${ACCENT}; padding-left:8px;">
                            <span style="color:${ACCENT}; letter-spacing:2px;">THE GARDEN</span><br>
                            A new comment on &ldquo;${esc(post.headline)}&rdquo;.</div>`,
                    });
                    app?.render(true);
                } },
                cancel: { label: "Cancel" },
            },
            default: "add",
        }, { width: 460 }).render(true);
    }

    function followersDialog(app) {
        const actor = squadActor();
        if (!actor) return ui.notifications.warn("No Media character is set up, so there is no following to edit.");
        new Dialog({
            title: "The Hyph Squad",
            content: `<form><div class="form-group"><label>${esc(actor.name)}'s followers</label>
                <input type="number" name="n" min="0" step="1" value="${followers(actor)}"></div>
                <p style="font-size:.8em;opacity:.7;margin:0;">A story the city believes adds 1d10 x 10 x her Credibility Rank cubed on its own.</p></form>`,
            buttons: {
                save: { label: "Save", callback: async (h) => {
                    await actor.setFlag(ID, "gardenFollowers", num(h[0].querySelector('[name="n"]').value, 0, 1e12));
                    app?.render(true);
                } },
                cancel: { label: "Cancel" },
            },
            default: "save",
        }, { width: 380 }).render(true);
    }

    /* ---------------------------------------------------------------- */
    /*  Clicks                                                           */
    /* ---------------------------------------------------------------- */

    async function onClick(app, action, ev) {
        const view = app._garden ?? (app._garden = { postId: null, raw: new Set() });
        const $t = $(ev.currentTarget);
        const postId = $t.data("post");

        try {
            switch (action) {
                case "gd-open":
                    view.postId = view.postId === postId ? null : postId;
                    app.render(true); break;

                case "gd-new": {
                    if (!canPublish()) break;
                    const wait = nextPublishIn();
                    if (wait) { ui.notifications.warn(`The city is still carrying your last story. ${wait} day${wait === 1 ? "" : "s"} to go.`); break; }
                    headlineDialog(app); break;
                }

                case "gd-roll": {
                    // Taken out of service on the first click, so a double-click cannot
                    // spend a second d10 while the first one is still in the air.
                    ev.currentTarget.disabled = true;
                    await believability(postId);
                    app.render(true); break;
                }

                case "gd-followers":
                    if (game.user.isGM) followersDialog(app); break;

                case "gd-add-comment": {
                    if (!game.user.isGM) break;
                    const post = posts().find((p) => p.id === postId);
                    if ((post?.comments || []).length >= MAX_COMMENTS) { ui.notifications.warn(`A story gets ${MAX_COMMENTS} comments and no more.`); break; }
                    commentDialog(app, postId); break;
                }

                case "gd-toggle": {
                    const cid = $t.data("comment");
                    if (!view.raw) view.raw = new Set();
                    view.raw.has(cid) ? view.raw.delete(cid) : view.raw.add(cid);
                    app.render(true); break;
                }

                case "gd-decipher":
                    ev.currentTarget.disabled = true;
                    await decipher(postId, $t.data("comment"));
                    app.render(true); break;

                case "gd-drop-post": {
                    if (!game.user.isGM) break;
                    if (!await Dialog.confirm({ title: "Delete post", content: "<p>Remove this headline and everything said under it?</p>" })) break;
                    await request({ op: "dropPost", postId });
                    view.postId = null; app.render(true); break;
                }

                case "gd-drop-comment": {
                    if (!game.user.isGM) break;
                    await request({ op: "dropComment", postId, commentId: $t.data("comment") });
                    app.render(true); break;
                }
            }
        } catch (err) {
            console.error("Garden |", err);
            ui.notifications.error(`The Garden: ${err.message}`);
        }
    }

    /* ---------------------------------------------------------------- */

    globalThis.VirtualAgentGarden = { html, onClick, canPublish };

    Hooks.once("init", () => {
        game.settings.register(ID, "gardenPosts", {
            scope: "world", config: false, type: String, default: "[]",
            onChange: () => redraw(),
        });
    });

    Hooks.once("ready", () => {
        game.socket.on(SOCKET, (msg) => {
            if (!msg?.garden || !isActiveGM()) return;
            apply(msg).catch((e) => { console.error("Garden |", e); ui.notifications.error(`The Garden: ${e.message}`); });
        });
        // A day passing is what lifts a failed Decipher, so the phone has to notice.
        Hooks.on("nunuCalendar.dateChanged", () => redraw());
    });
})();
