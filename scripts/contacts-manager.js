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
        { id: "allied", label: "Ally", colour: "#64ffda" },
        { id: "neutral", label: "Neutral", colour: "#8b9183" },
        { id: "hostile", label: "Enemy", colour: "#ff3366" },
    ];
    const standing = (id) => STANDINGS.find((s) => s.id === id) ?? STANDINGS[1];

    /** The ten Roles of Cyberpunk RED. Most people have none, so the list starts empty. */
    const ROLES = ["Exec", "Fixer", "Lawman", "Media", "Medtech", "Netrunner", "Nomad", "Rockerboy", "Solo", "Tech"];

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
        return [...byId.values()].map((c) => ({
            ...c,
            holders: [...c.holders],
            faction: meta[c.id]?.faction || "",
            standing: meta[c.id]?.standing || "neutral",
            role: meta[c.id]?.role || "",
        }));
    }

    /** Writes a contact to exactly the players who should hold it, and nobody else. */
    async function save({ id, name, avatar, holders }) {
        const record = (targets) => ({ id, name, originalName: name, avatar: avatar || null, isPlayer: false, ownerId: game.user.id, targetUserIds: targets });
        const gmList = (game.user.getFlag(ID, "customContacts") || []).filter((c) => c.id !== id);
        if (holders.length) gmList.push(record(holders));
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

            const party = players().map((u) => ({ id: u.id, name: whoIs(u), img: u.character?.img || "icons/svg/mystery-man.svg" }));
            return {
                sort: this.sort,
                standings: STANDINGS,
                roles: ROLES,
                party,
                editing: this.editing,
                contacts: list.map((c) => ({
                    ...c,
                    standingLabel: standing(c.standing).label,
                    standingColour: standing(c.standing).colour,
                    holderNames: c.holders.map((id) => game.users.get(id)).filter(Boolean).map(whoIs).join(", "),
                    party: party.map((p) => ({ ...p, has: c.holders.includes(p.id) })),
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
                await save({ id, name: "New contact", avatar: null, holders: [] });
                this.editing = id;
                this.render(true);
            });

            html.on("click", "[data-save]", async (ev) => {
                const id = ev.currentTarget.dataset.save;
                const card = $(ev.currentTarget).closest("[data-card]");
                const name = (card.find("[data-field=name]").val() || "").trim() || "Unnamed";
                const avatar = (card.find("[data-field=avatar]").val() || "").trim();
                const faction = (card.find("[data-field=faction]").val() || "").trim();
                const stand = card.find("[data-field=standing]").val() || "neutral";
                const role = card.find("[data-field=role]").val() || "";
                const holders = card.find("[data-holder]:checked").toArray().map((el) => el.dataset.holder);

                await save({ id, name, avatar, holders });
                const meta = readMeta();
                meta[id] = { ...(meta[id] || {}), faction, standing: stand, role };
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

            html.on("click", "[data-browse]", async (ev) => {
                const input = $(ev.currentTarget).closest("[data-card]").find("[data-field=avatar]");
                new FilePicker({ type: "image", current: String(input.val() || ""), callback: (path) => input.val(path) }).browse();
            });
        }
    }

    /* ---------------------------------------------------------------- */

    globalThis.VirtualAgentContacts = { open: () => new ContactsManager().render(true), allContacts, save, remove };

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
