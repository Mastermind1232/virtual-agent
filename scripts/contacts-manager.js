/* ------------------------------------------------------------------ *
 *  NuNu packaging: the Contacts manager.
 *
 *  A GM window for the people the party can call. Upstream only lets
 *  contacts be made one at a time from inside the phone, with no way to
 *  see who holds whom, so this is the book behind all six devices.
 *
 *  Everything it writes is the same storage the phone already reads:
 *  each user's `customContacts` flag, and the world `contactMeta` map
 *  that carries a contact's affiliation and where they stand.
 * ------------------------------------------------------------------ */

(() => {
    const ID = "VirtualAgent";

    const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    const players = () => game.users.filter((u) => !u.isGM);
    const whoIs = (u) => u.character?.name || u.name;

    const STANDINGS = [
        { id: "allied", label: "Ally", colour: "#6eb475" },
        { id: "neutral", label: "Neutral", colour: "#8b9183" },
        { id: "hostile", label: "Enemy", colour: "#ff3366" },
    ];
    const standing = (id) => STANDINGS.find((s) => s.id === id) ?? STANDINGS[1];

    /** The ten Roles of Cyberpunk RED. Most people have none, so the list starts empty. */
    const ROLES = ["Exec", "Fixer", "Lawman", "Media", "Medtech", "Netrunner", "Nomad", "Rockerboy", "Solo", "Tech"];

    const PLACEHOLDER = /^icons\/svg\/(mystery-man|cowled)\.svg$/;

    /** The face to show for an actor: their token first, since that is how they appear at
        the table, falling back to the sheet portrait. */
    const faceOf = (actor) => {
        const token = actor?.prototypeToken?.texture?.src;
        if (token && !PLACEHOLDER.test(token)) return token;
        return actor?.img && !PLACEHOLDER.test(actor.img) ? actor.img : "";
    };

    /** What an actor's sheet says their Role is. The Role item is preferred over the free
        text field beside the name, because that item is what carries their rank. */
    const roleOnSheet = (actor) => (actor?.itemTypes?.role ?? [])[0]?.name || actor?.system?.roleInfo?.activeRole || "";

    /** The actor a contact is, when one is linked and still exists. */
    const linkedActor = (uuid) => { try { const a = uuid ? fromUuidSync(uuid) : null; return a?.documentName === "Actor" ? a : null; } catch (e) { return null; } };

    const readMeta = () => {
        try { const raw = game.settings.get(ID, "contactMeta"); return typeof raw === "string" ? JSON.parse(raw || "{}") : (raw || {}); }
        catch (e) { return {}; }
    };
    const writeMeta = (m) => game.settings.set(ID, "contactMeta", JSON.stringify(m));

    /** Every NPC contact in the world, gathered from the GM's book and every player's phone. */
    function allContacts() {
        const meta = readMeta();
        const byId = new Map();
        const collect = (user) => {
            for (const c of user.getFlag(ID, "customContacts") || []) {
                if (!String(c.id).startsWith("npc_")) continue;
                const seen = byId.get(c.id) ?? { id: c.id, name: c.originalName || c.name, avatar: c.avatar || null, holders: new Set() };
                if (c.avatar && !seen.avatar) seen.avatar = c.avatar;
                for (const uid of c.targetUserIds || []) if (game.users.get(uid)?.isGM === false) seen.holders.add(uid);
                byId.set(c.id, seen);
            }
        };
        for (const u of game.users) collect(u);
        return [...byId.values()].map((c) => {
            // A linked actor is who this person is. The stored copy is only a cache, so a
            // rename or a new portrait on the sheet shows here without anything being re-saved.
            const actor = linkedActor(meta[c.id]?.actorUuid);
            return {
            ...c,
            name: actor?.name || c.name,
            avatar: faceOf(actor) || c.avatar,
            holders: [...c.holders],
            faction: meta[c.id]?.faction || "",
            standing: meta[c.id]?.standing || "neutral",
            role: roleOnSheet(actor) || meta[c.id]?.role || "",
            actorUuid: meta[c.id]?.actorUuid || "",
        }; });
    }

    /* ---------------------------------------------------------------- */

    /** The phone reads the stored copy rather than the sheet, so when a linked actor is
        renamed or re-portrayed the copy on every device is rewritten to match. */
    async function syncFromActors(only = null) {
        if (!game.user.isGM) return;
        const meta = readMeta();
        for (const c of allContacts()) {
            const uuid = meta[c.id]?.actorUuid;
            if (!uuid || (only && uuid !== only)) continue;
            const actor = linkedActor(uuid);
            if (!actor) continue;
            const avatar = faceOf(actor) || c.avatar || null;

            // Only touch the flags when the stored copy has actually drifted.
            const stale = game.users.some((u) => (u.getFlag(ID, "customContacts") || [])
                .some((r) => r.id === c.id && (r.name !== actor.name || r.originalName !== actor.name || (r.avatar || null) !== avatar)));
            if (stale) await save({ id: c.id, name: actor.name, avatar, holders: c.holders });
        }
    }

    /** Writes a contact to exactly the players who should hold it, and nobody else. */
    async function save({ id, name, avatar, holders }) {
        const record = (targets) => ({ id, name, originalName: name, avatar: avatar || null, isPlayer: false, ownerId: game.user.id, targetUserIds: targets });
        // The GM's own list is the book, so it keeps the record whether or not anybody
        // holds the number. Writing it only when somebody does meant a new contact, and any
        // contact whose last holder was unticked, vanished from the world with no warning.
        const gmList = (game.user.getFlag(ID, "customContacts") || []).filter((c) => c.id !== id);
        gmList.push(record(holders));
        await game.user.setFlag(ID, "customContacts", gmList);

        for (const u of players()) {
            const theirs = (u.getFlag(ID, "customContacts") || []).filter((c) => c.id !== id);
            if (holders.includes(u.id)) theirs.push(record(holders));
            await u.setFlag(ID, "customContacts", theirs);
        }
        globalThis.AgentDeviceApp?.ui?.rendered && globalThis.AgentDeviceApp.ui.render(true);
    }

    async function remove(id) {
        for (const u of game.users) {
            const list = u.getFlag(ID, "customContacts") || [];
            if (list.some((c) => c.id === id)) await u.setFlag(ID, "customContacts", list.filter((c) => c.id !== id));
        }
        const meta = readMeta(); delete meta[id]; await writeMeta(meta);
        globalThis.AgentDeviceApp?.ui?.rendered && globalThis.AgentDeviceApp.ui.render(true);
    }

    /* ---------------------------------------------------------------- */

    class ContactsManager extends Application {
        static get defaultOptions() {
            return foundry.utils.mergeObject(super.defaultOptions, {
                id: "nunu-contacts-manager",
                title: "Contacts",
                template: `modules/${ID}/templates/contacts-manager.hbs`,
                width: 680,
                height: 620,
                resizable: true,
                classes: ["nunu-contacts"],
            });
        }

        constructor(...args) { super(...args); this.sort = "name"; this.editing = null; }

        getData() {
            const list = allContacts();
            const order = { name: (a, b) => a.name.localeCompare(b.name),
                faction: (a, b) => (a.faction || "~").localeCompare(b.faction || "~") || a.name.localeCompare(b.name),
                standing: (a, b) => STANDINGS.findIndex((s) => s.id === a.standing) - STANDINGS.findIndex((s) => s.id === b.standing) || a.name.localeCompare(b.name) };
            list.sort(order[this.sort] ?? order.name);

            const party = players().map((u) => ({ id: u.id, name: whoIs(u), img: faceOf(u.character) || "icons/svg/mystery-man.svg" }));
            const playerActorIds = new Set(players().map((u) => u.character?.id).filter(Boolean));
            const actors = game.actors
                .filter((a) => !playerActorIds.has(a.id))
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((a) => ({ uuid: a.uuid, name: a.name }));
            return {
                sort: this.sort,
                standings: STANDINGS,
                roles: ROLES,
                actors,
                party,
                editing: this.editing,
                contacts: list.map((c) => ({
                    ...c,
                    standingLabel: standing(c.standing).label,
                    standingColour: standing(c.standing).colour,
                    holderNames: c.holders.map((id) => game.users.get(id)).filter(Boolean).map(whoIs).join(", "),
                    party: party.map((p) => ({ ...p, has: c.holders.includes(p.id) })),
                    isOperator: !!globalThis.VirtualAgentOperator?.rosterHas?.(c.name),
                    actor: linkedActor(c.actorUuid),
                    roleFromSheet: !!roleOnSheet(linkedActor(c.actorUuid)),
                    hasActor: !!linkedActor(c.actorUuid),
                    open: this.editing === c.id,
                })),
            };
        }

        activateListeners(html) {
            super.activateListeners(html);

            html.on("change", "[data-sort]", (ev) => { this.sort = ev.currentTarget.value; this.render(true); });

            html.on("click", "[data-open]", (ev) => {
                const id = ev.currentTarget.dataset.open;
                this.editing = this.editing === id ? null : id;
                this.render(true);
            });

            html.on("click", "[data-new]", async () => {
                const id = `npc_${foundry.utils.randomID()}`;
                await save({ id, name: "Unlinked contact", avatar: null, holders: [] });
                this.editing = id;
                this.render(true);
            });

            html.on("click", "[data-save]", async (ev) => {
                const id = ev.currentTarget.dataset.save;
                const card = $(ev.currentTarget).closest("[data-card]");
                const actorUuid = card.find("[data-field=actor]").val() || "";
                const actor = linkedActor(actorUuid);
                // A linked actor is the source of truth for who this is.
                const name = actor?.name || (card.find("[data-field=name]").val() || "").trim() || "Unnamed";
                const avatar = faceOf(actor) || (card.find("[data-field=avatar]").val() || "").trim();
                const faction = (card.find("[data-field=faction]").val() || "").trim();
                const stand = card.find("[data-field=standing]").val() || "neutral";
                const role = roleOnSheet(actor) ? "" : (card.find("[data-field=role]").val() || "");
                const holders = card.find("[data-holder]:checked").toArray().map((el) => el.dataset.holder);

                await save({ id, name, avatar, holders });

                // On the Operator roster or not. Adding needs an actor, since an operator's
                // usable skills are read from their sheet.
                const OP = globalThis.VirtualAgentOperator;
                if (OP?.rosterAdd) {
                    const wantsOperator = card.find("[data-field=operator]").is(":checked");
                    const onRoster = OP.rosterHas(name);
                    if (wantsOperator && !onRoster) {
                        if (actor) await OP.rosterAdd(actor.name, actor.uuid);
                        else ui.notifications.warn("Link this contact to an actor first: an operator's usable skills come from their sheet.");
                    } else if (!wantsOperator && onRoster) await OP.rosterRemove(name);
                }

                const meta = readMeta();
                meta[id] = { ...(meta[id] || {}), faction, standing: stand, role, actorUuid };
                await writeMeta(meta);
                ui.notifications.info(`Contacts: ${name} saved.`);
                this.editing = null;
                this.render(true);
            });

            html.on("click", "[data-delete]", async (ev) => {
                const id = ev.currentTarget.dataset.delete;
                const who = allContacts().find((c) => c.id === id)?.name ?? "this contact";
                if (!await Dialog.confirm({ title: "Delete contact", content: `<p>Remove <b>${esc(who)}</b> from every phone? Their conversations are kept.</p>` })) return;
                await remove(id);
                this.editing = null;
                this.render(true);
            });

            html.on("change", "[data-field=actor]", (ev) => {
                const a = linkedActor(ev.currentTarget.value);
                if (!a) return;
                const card = $(ev.currentTarget).closest("[data-card]");
                card.find("[data-field=name]").val(a.name);
                const face = faceOf(a); if (face) card.find("[data-field=avatar]").val(face);
            });

            html.on("click", "[data-browse]", async (ev) => {
                const input = $(ev.currentTarget).closest("[data-card]").find("[data-field=avatar]");
                new FilePicker({ type: "image", current: String(input.val() || ""), callback: (path) => input.val(path) }).browse();
            });
        }
    }

    /* ---------------------------------------------------------------- */

    globalThis.VirtualAgentContacts = { open: () => new ContactsManager().render(true), allContacts, save, remove, syncFromActors };

    // Renaming or re-portraying an actor updates every contact pointing at it.
    Hooks.on("updateActor", (actor, changes) => {
        if (!game.user.isGM) return;
        if (!("name" in changes) && !("img" in changes) && !("prototypeToken" in changes)) return;
        syncFromActors(actor.uuid).catch((e) => console.error("Contacts |", e));
    });

    // Anything that drifted while nobody was watching is put right on load.
    Hooks.once("ready", () => {
        if (game.user.isGM) syncFromActors().catch((e) => console.error("Contacts |", e));
    });

    Hooks.on("renderActorDirectory", (app, html) => {
        if (!game.user.isGM) return;
        const root = html instanceof HTMLElement ? html : html[0];
        if (!root || root.querySelector(".nunu-contacts-btn")) return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "nunu-contacts-btn";
        btn.innerHTML = '<i class="fas fa-address-book"></i> Contacts';
        btn.addEventListener("click", () => globalThis.VirtualAgentContacts.open());

        // Sits with the other directory buttons, above the Improvement ones. No wrapper and
        // no flex overrides: a full-width row of its own pushed them out of the footer.
        const improvement = Array.from(root.querySelectorAll("button")).find((b) => /improvement/i.test(b.textContent));
        const creator = Array.from(root.querySelectorAll("button")).find((b) => /character creator/i.test(b.textContent));
        const anchor = improvement ?? creator;
        if (anchor?.parentElement) anchor.parentElement.insertBefore(btn, improvement ? improvement : creator.nextSibling);
        else (root.querySelector(".directory-footer") ?? root.querySelector(".directory-header") ?? root).appendChild(btn);
    });
})();
