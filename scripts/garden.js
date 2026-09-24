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
 * ------------------------------------------------------------------ */

(() => {
    const ID = "VirtualAgent";
    const ACCENT = "#ff1493";

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const uid = () => foundry.utils.randomID();

    const calendar = () => game.modules.get("nunu-calendar")?.api ?? null;
    const dateKey = (d) => d ? `${d.y}-${String(d.m).padStart(2, "0")}-${String(d.d).padStart(2, "0")}` : "";
    const today = () => dateKey(calendar()?.getDate?.());
    const prettyDate = (k) => {
        const cal = calendar(); if (!cal || !k) return k ?? "";
        const [y, m, d] = k.split("-").map(Number);
        return cal.shortDate ? cal.shortDate({ y, m, d }) : k;
    };

    const posts = () => {
        try { const raw = game.settings.get(ID, "gardenPosts"); const v = typeof raw === "string" ? JSON.parse(raw || "[]") : raw; return Array.isArray(v) ? v : []; }
        catch (e) { return []; }
    };
    const savePosts = (v) => game.settings.set(ID, "gardenPosts", JSON.stringify(v));

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

    /** Days since a date key, or null when the calendar is not running. */
    const daysSince = (k) => {
        const t = calendar()?.getDate?.(); if (!t || !k) return null;
        const [y, m, d] = k.split("-").map(Number);
        return Math.round((Date.UTC(t.y, t.m - 1, t.d) - Date.UTC(y, m - 1, d)) / 86400000);
    };

    /** The city will carry one story a week. Anything more and none of them land. */
    function nextPublishIn() {
        const mine = posts().filter((p) => p.authorName === (actorOf(game.user)?.name || game.user.name));
        const last = mine[mine.length - 1];
        if (!last?.posted) return 0;
        const since = daysSince(last.posted);
        return since === null ? 0 : Math.max(0, 7 - since);
    }

    const credibility = (actor) => {
        const role = (actor?.itemTypes?.role ?? [])[0];
        return Number(role?.system?.rank) || 0;
    };

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

    async function decipher(postId, commentId) {
        const actor = actorOf(game.user);
        if (!actor) return ui.notifications.warn("No character is assigned, so there is nothing to roll.");

        const list = posts();
        const post = list.find((p) => p.id === postId);
        const comment = post?.comments?.find((c) => c.id === commentId);
        if (!comment || comment.deciphered) return;
        if (lockedToday(comment)) return ui.notifications.warn("You have already worked at this one today. Try again tomorrow.");

        const total = skillTotal(actor, "Deduction");
        const roll = await new Roll("1d10").evaluate();
        const sum = roll.total + total;
        const dv = Number(comment.dv) || 15;
        const won = sum >= dv;

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Deciphering a comment on "${esc(post.headline)}" &middot; Deduction ${total} + ${roll.total} = ${sum}`,
        });

        const i = list.findIndex((p) => p.id === postId);
        const j = list[i].comments.findIndex((c) => c.id === commentId);
        list[i].comments[j] = won
            ? { ...comment, deciphered: true, failedOn: "" }
            : { ...comment, failedOn: today() };
        await request({ op: "savePosts", value: list });

        ui.notifications[won ? "info" : "warn"](won
            ? "You read what they were actually saying."
            : "It does not come apart. Sleep on it.");
    }

    /* ---------------------------------------------------------------- */
    /*  Writes                                                           */
    /*                                                                   */
    /*  Posts live in a world setting, which only a GM can write, so a    */
    /*  player's publishing and deciphering is relayed over the socket.   */
    /* ---------------------------------------------------------------- */

    const SOCKET = `module.${ID}`;
    const activeGM = () => game.users.filter((u) => u.isGM && u.active).sort((a, b) => a.id.localeCompare(b.id))[0] ?? null;
    const isActiveGM = () => activeGM()?.id === game.user.id;

    async function request(payload) {
        if (game.user.isGM) return apply(payload);
        if (!activeGM()) return ui.notifications.warn("No GM is connected, so the Garden cannot record that.");
        game.socket.emit(SOCKET, { garden: true, ...payload, userId: game.user.id });
    }

    async function apply(msg) {
        if (!game.user.isGM) return;
        if (msg.op === "savePosts") {
            await savePosts(msg.value);
            const app = globalThis.AgentDeviceApp?.ui;
            if (app?.rendered) app.render(true);
        }
    }

    async function publish(headline, evidence = 0) {
        const actor = actorOf(game.user);
        const list = posts();
        list.push({
            id: uid(),
            headline,
            authorName: actor?.name || game.user.name,
            credibility: credibility(actor),
            posted: today(),
            evidence,
            comments: [],
        });
        await request({ op: "savePosts", value: list });

        const whisper = game.users.filter((u) => u.isGM).map((u) => u.id);
        await ChatMessage.create({
            whisper,
            content: `<div style="font-family: monospace; font-size: .8rem; border-left: 3px solid ${ACCENT}; padding-left: 8px;">
                <span style="color:${ACCENT}; letter-spacing:2px;">THE GARDEN</span><br>
                <b>${esc(actor?.name || game.user.name)}</b> published: &ldquo;${esc(headline)}&rdquo;</div>`,
        });
        await believability(actor, headline, evidence);
    }

    /** Believability: a flat d10 under the threshold for her Credibility Rank. Rolled on
        publishing, and again whenever it matters whether a particular person believes it. */
    const BELIEVABILITY = { 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, 6: 4, 7: 5, 8: 5, 9: 6, 10: 7 };

    async function believability(actor, headline, evidence = 0) {
        const rank = credibility(actor);
        const base = BELIEVABILITY[rank] ?? 2;
        const target = Math.min(10, base + (Number(evidence) || 0));
        const roll = await new Roll("1d10").evaluate();
        const believed = roll.total <= target;

        await roll.toMessage({
            speaker: ChatMessage.getSpeaker({ actor }),
            flavor: `Believability &middot; Credibility Rank ${rank}, ${base} in 10${evidence ? ` and +${evidence} for evidence, so ${target} in 10` : ""}`,
        });
        await ChatMessage.create({
            whisper: [...game.users.filter((u) => u.isGM).map((u) => u.id), game.user.id],
            content: `<div style="font-family: monospace; font-size:.8rem; border-left:3px solid ${ACCENT}; padding-left:8px;">
                <span style="color:${ACCENT}; letter-spacing:2px;">THE GARDEN</span><br>
                &ldquo;${esc(headline)}&rdquo;<br>
                ${believed
                    ? `<b style="color:#64ffda;">The city believes it.</b>`
                    : `<b style="color:#ff3366;">The city does not buy it.</b>`}
                Rolled ${roll.total} against ${target}.</div>`,
        });
        return believed;
    }

    /* ---------------------------------------------------------------- */
    /*  Markup                                                           */
    /* ---------------------------------------------------------------- */

    function commentRow(post, c, mine) {
        const coded = c.coded && !c.deciphered;
        const locked = lockedToday(c);
        const body = c.deciphered
            ? `<div style="font-size:.7rem;color:#ddd;white-space:pre-wrap;">${esc(c.text)}</div>
               <div style="margin-top:5px;padding:6px 8px;border-left:2px solid ${ACCENT};background:rgba(255,20,147,.07);font-size:.7rem;color:#fff;white-space:pre-wrap;">${esc(c.intent)}</div>`
            : `<div style="font-size:.7rem;color:${coded ? "#b9a7c4" : "#ddd"};white-space:pre-wrap;${coded ? "font-family:monospace;letter-spacing:.5px;" : ""}">${esc(c.text)}</div>`;

        const tag = coded
            ? `<span style="font-size:.5rem;border:1px solid #9b6dff;color:#9b6dff;border-radius:3px;padding:0 5px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;">coded</span>`
            : (c.deciphered ? `<span style="font-size:.5rem;border:1px solid ${ACCENT};color:${ACCENT};border-radius:3px;padding:0 5px;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap;">read</span>` : "");

        const button = (mine && coded)
            ? `<button type="button" data-action="gd-decipher" data-post="${post.id}" data-comment="${c.id}" ${locked ? "disabled" : ""}
                 style="font-family:inherit;margin-top:6px;background:${locked ? "transparent" : "rgba(155,109,255,.15)"};border:1px solid ${locked ? "#463a5c" : "#9b6dff"};color:${locked ? "#6c6280" : "#9b6dff"};border-radius:3px;font-size:.65rem;padding:3px 10px;cursor:${locked ? "default" : "pointer"};">
                 ${locked ? "Nothing more today" : "Decipher"}</button>`
            : "";

        const gm = game.user.isGM
            ? `<button type="button" data-action="gd-drop-comment" data-post="${post.id}" data-comment="${c.id}" title="Delete"
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
        const mine = canPublish();
        const unread = (post.comments || []).filter((c) => c.coded && !c.deciphered).length;

        const head = `<div data-action="gd-open" data-post="${post.id}" style="cursor:pointer;">
            <div style="color:#fff;font-size:.9rem;font-weight:700;line-height:1.3;">${esc(post.headline)}</div>
            <div style="font-size:.6rem;color:#7f8a99;margin-top:3px;">
                ${esc(post.authorName)}${post.posted ? ` &middot; ${esc(prettyDate(post.posted))}` : ""}
                &middot; ${(post.comments || []).length} comment${(post.comments || []).length === 1 ? "" : "s"}
                ${unread && mine ? ` &middot; <span style="color:#9b6dff;">${unread} in code</span>` : ""}
            </div></div>`;

        if (!open) return `<div style="background:rgba(255,255,255,.03);border:1px solid #222;border-radius:6px;padding:10px;margin-bottom:8px;">${head}</div>`;

        const comments = (post.comments || []).length
            ? post.comments.map((c) => commentRow(post, c, mine)).join("")
            : `<div style="font-size:.65rem;color:#5a5f54;padding:10px 0;">Nobody has said anything yet.</div>`;

        const gmTools = game.user.isGM
            ? `<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">
                <button type="button" data-action="gd-add-comment" data-post="${post.id}" style="font-family:inherit;background:rgba(255,20,147,.14);border:1px solid ${ACCENT};color:${ACCENT};border-radius:3px;font-size:.65rem;padding:3px 9px;cursor:pointer;">Add comment</button>
                <button type="button" data-action="gd-drop-post" data-post="${post.id}" style="font-family:inherit;background:transparent;border:1px solid #553;color:#997;border-radius:3px;font-size:.65rem;padding:3px 9px;cursor:pointer;">Delete post</button>
               </div>`
            : "";

        return `<div style="background:rgba(255,255,255,.03);border:1px solid ${ACCENT};border-radius:6px;padding:10px;margin-bottom:8px;">
            ${head}<div style="margin-top:8px;">${comments}</div>${gmTools}</div>`;
    }

    function html(app) {
        const view = app._garden ?? (app._garden = { postId: null });
        const list = posts().slice().reverse();

        const body = list.length
            ? list.map((p) => postCard(p, view)).join("")
            : `<div style="text-align:center;color:#5a5f54;font-size:.7rem;padding:34px 12px;">Nothing published yet.${canPublish() ? " Tap + to write a headline." : ""}</div>`;

        return `<div class="app-header drag-handle" style="justify-content:space-between;">
                <span data-action="back-to-home" style="display:flex;align-items:center;gap:10px;cursor:pointer;">
                    <i class="fas fa-chevron-left" style="color:${ACCENT};"></i>
                    <h3 style="color:${ACCENT};margin:0;">The Garden</h3>
                </span>
                ${canPublish() ? `<button type="button" data-action="gd-new" title="${nextPublishIn() ? `The city is still carrying your last story. ${nextPublishIn()} day${nextPublishIn() === 1 ? "" : "s"} to go.` : "Write a headline"}" ${nextPublishIn() ? "disabled" : ""} style="font-family:inherit;background:rgba(255,20,147,.18);border:1px solid ${ACCENT};color:${ACCENT};width:30px;height:30px;border-radius:50%;cursor:${nextPublishIn() ? "default" : "pointer"};font-size:.9rem;opacity:${nextPublishIn() ? ".4" : "1"};">+</button>` : ""}
            </div>
            <div style="flex:1;overflow-y:auto;padding:10px;">${body}</div>`;
    }

    /* ---------------------------------------------------------------- */
    /*  Dialogs                                                          */
    /* ---------------------------------------------------------------- */

    function headlineDialog(app) {
        new Dialog({
            title: "Publish to the Garden",
            content: `<form>
                <div class="form-group"><label>Headline</label><input type="text" name="headline" placeholder="What you are telling the city."></div>
                <div class="form-group"><label>Backed by</label>
                    <select name="evidence">
                        <option value="0">Nothing the public can check</option>
                        <option value="1">One piece of verifiable evidence</option>
                        <option value="3">More than four distinct pieces</option>
                    </select>
                </div>
                <p style="font-size:.8em;opacity:.7;">The headline is the whole post. What the city says back depends on what you chose to say. Believability is rolled as soon as it goes up, and the city will carry one story a week.</p>
            </form>`,
            buttons: {
                post: { label: "Publish", callback: async (h) => {
                    const f = h[0].querySelector("form");
                    const v = f.headline.value.trim();
                    if (!v) return ui.notifications.warn("A headline is the post; there has to be one.");
                    await publish(v, Number(f.evidence.value) || 0);
                    app?.render(true);
                } },
                cancel: { label: "Cancel" },
            },
            default: "post",
        }, { width: 440 }).render(true);
    }

    function commentDialog(app, postId) {
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
                    if (!text) return ui.notifications.warn("The comment needs something in it.");
                    const list = posts();
                    const i = list.findIndex((p) => p.id === postId);
                    if (i < 0) return;
                    list[i].comments = [...(list[i].comments || []), {
                        id: uid(),
                        who: f.who.value.trim() || "anon",
                        text,
                        coded: f.coded.checked,
                        intent: f.intent.value.trim(),
                        dv: Math.max(1, Number(f.dv.value) || 15),
                        deciphered: false,
                        failedOn: "",
                    }];
                    await savePosts(list);

                    // The Media hears the city answer even with the phone shut.
                    const who = mediaUser();
                    if (who) await ChatMessage.create({
                        whisper: [who.id, ...game.users.filter((u) => u.isGM).map((u) => u.id)],
                        content: `<div style="font-family: monospace; font-size:.8rem; border-left:3px solid ${ACCENT}; padding-left:8px;">
                            <span style="color:${ACCENT}; letter-spacing:2px;">THE GARDEN</span><br>
                            A new comment on &ldquo;${esc(list[i].headline)}&rdquo;.</div>`,
                    });
                    app?.render(true);
                } },
                cancel: { label: "Cancel" },
            },
            default: "add",
        }, { width: 460 }).render(true);
    }

    /* ---------------------------------------------------------------- */
    /*  Clicks                                                           */
    /* ---------------------------------------------------------------- */

    async function onClick(app, action, ev) {
        const view = app._garden ?? (app._garden = { postId: null });
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

                case "gd-add-comment":
                    if (game.user.isGM) commentDialog(app, postId); break;

                case "gd-decipher":
                    await decipher(postId, $t.data("comment"));
                    app.render(true); break;

                case "gd-drop-post": {
                    if (!game.user.isGM) break;
                    if (!await Dialog.confirm({ title: "Delete post", content: "<p>Remove this headline and everything said under it?</p>" })) break;
                    await savePosts(posts().filter((p) => p.id !== postId));
                    view.postId = null; app.render(true); break;
                }

                case "gd-drop-comment": {
                    if (!game.user.isGM) break;
                    const cid = $t.data("comment");
                    const list = posts();
                    const i = list.findIndex((p) => p.id === postId);
                    if (i < 0) break;
                    list[i].comments = (list[i].comments || []).filter((c) => c.id !== cid);
                    await savePosts(list); app.render(true); break;
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
            onChange: () => { const a = globalThis.AgentDeviceApp?.ui; if (a?.rendered) a.render(true); },
        });
    });

    Hooks.once("ready", () => {
        game.socket.on(SOCKET, (msg) => {
            if (!msg?.garden || !isActiveGM()) return;
            apply(msg).catch((e) => { console.error("Garden |", e); ui.notifications.error(`The Garden: ${e.message}`); });
        });
    });
})();
