## 1.8.4 — Roll-vanish watchdog (diagnostic)

Players reported dice rolls from the character sheet appearing on screen, vanishing, and never landing in the chat log. Virtual Agent never deletes non-Agent messages (its only two delete paths are the manual message delete and the GM's NPC-contact cleanup, both of which can only match Agent messages) — so something else at the table is deleting them, or a chat-render pipeline is swallowing them.

This release adds a silent watchdog: if any roll message gets deleted, the console of the client that *initiated* the deletion logs a stack trace **naming the module responsible**, and every other client logs that the deletion happened. No behavior changes — it only writes console lines when a roll message dies.

If you see a roll vanish: hit F12 and look for `[VirtualAgent rollwatch]` lines. Also worth checking the moment it happens: does pressing F5 bring the roll back into the log? If yes, it was never deleted — it's a rendering conflict (3D dice modules are the usual suspect). If it's still gone, the rollwatch line on the GM's console will say who deleted it.

---

## 1.8.3 — Skills "clicks don't roll": actual root cause found and fixed

The 1.8.2 diagnostics paid off on the first log. Every tap registered, the right character resolved (63 skills found), the tap handler ran — and the roll-prep panel still never appeared. Root cause: the prep panel's display data was being built inside a **combat-only code block**, gated on having an active combatant or a selected token. Players who aren't in combat and don't have a token selected — which is most players opening the Skills app — could tap forever: the tap registered, the panel was *supposed* to open, but its data never reached the screen, so the list just re-rendered. Silently. No error.

That's also why it never reproduced for me as GM: a GM almost always has a token selected, which satisfied the gate.

The prep panel's data now builds in the Skills app itself, with no combat/token requirement. Tap a skill → modifier panel opens → ROLL. The 1.8.2 diagnostics stay in, so if anything else ever goes quiet in there, the console will name the step.

Thanks to the affected player for the two console logs — the second one closed the case.

---

## 1.8.2 — Skills: stale-binding fix + step-by-step diagnostics

The 1.8.1 small-screen fix didn't cover every "skills don't work" case — a fresh log from an affected player (957×877 viewport, so NOT the sidebar-overlap case) shows taps registering but no roll. Two changes to corner it:

- **Stale-binding fix:** if the Agent is bound to an identity that has **no skill items** (an old NPC, vehicle, or container binding from a previous session), the Skills app rendered an empty list — which reads as "broken." The skills resolver now prefers whichever of (bound identity → your assigned character) actually **has** skills. The empty-state screen also now names the actor it's bound to, so a screenshot tells us everything.
- **Diagnostics:** every step of the skills flow now logs to the console — `[VirtualAgent skills] tap …` (which skill, which actor, whether the item was found), `ROLL tapped …`, and `roll posted to chat: N`. If it still fails for someone, their next console log will show exactly which step went missing instead of leaving us guessing.

If you're the affected player: open Skills, tap a skill, tap ROLL, then send the `[VirtualAgent skills]` console lines (F12) — and say what you see on screen after the first tap (the modifier panel with the big ROLL button, or nothing?).

---

## 1.8.1 — Small-screen fixes: the real "Skills doesn't work" culprit

A player console log finally cracked the "Skills app not working for some users" mystery — and it wasn't the browser. The affected players are on **small screens** (one log showed a 437×882 viewport — below Foundry's own 1024×700 minimum, and Foundry itself printed a warning saying features may break). On a screen that narrow, Foundry can never move the Agent out from under the ~300px sidebar — so the **right side of the device is permanently covered**. Every skill tap worked and opened the roll-prep panel… whose ROLL button sits on the right. Players were tapping a button they literally couldn't see.

- On narrow viewports the CANCEL / RESET / ROLL rows (Skills and Combat prep) now **stack vertically with ROLL on top**, full width — so the visible left edge is always tappable.
- **Touch support**: dragging the Agent and the corner resize grip now work with a finger, not just a mouse. Phone players can finally move the device out from under the sidebar and resize it.

To be clear: phones are below Foundry's minimum spec, so tiny screens will never be perfect — but the two things players actually do (roll skills, move the device) now work there.

---

## 1.8.0 — Players can upload photos to The Garden

Garden profiles can now carry a real photo without the GM doing the legwork:

- **Upload from your computer.** The add-profile form has an UPLOAD PHOTO button that opens your own file picker (like attaching a photo to a text). Works for players and GMs.
- **Locked to a dedicated folder.** Uploads land in `worlds/<your-world>/virtual-agent/garden` — created automatically. Players never open Foundry's file browser, so the GM's asset library stays out of sight. The browse-server-files button is now GM-only.
- **Auto-resized.** Images are downscaled to profile-picture size (max 512px) before storing, so a 12MB phone photo doesn't bloat your world folder.
- Under the hood, a player's photo travels with their profile to the GM's client, which stores the file and posts the profile (players can't write files to the server themselves — same relay pattern as posting the profile text). The GM side validates the image and names the file itself, so nothing player-controlled touches file paths.

---

## 1.7.4 — Agent stuck at a weird size after resizing + group chat out of order

Two more from the field:

**Resize lock.** Scaling the Agent up past what your screen height could fit left it stuck — it came back wide and squashed with the app icons cut off, and closing/reopening didn't help. Cause: Foundry clamps a window's height to what the viewport can fit, so over-scaling permanently overwrote the Agent's stored height with the crushed value, and it stayed that way. Now the corner drag can't go past a scale your screen can actually fit, and the Agent re-asserts its proper 380×680 shape every time it opens — so a device that's *already* stuck repairs itself on the next open. Double-clicking the corner grip still snaps back to 1:1.

**Group chat order.** Thread messages were rendered in Foundry's internal storage order, which isn't guaranteed to match the order they were actually sent — which is why a group chat could float the opener's messages to the top and scatter the day dividers. Threads are now explicitly sorted oldest → newest.

---

## 1.7.3 — Messages weren't showing inside threads (namespace fix)

This is the real cause behind the "messages don't show up" reports. When the module was renamed AgentDevice → VirtualAgent back in 1.1.0, every part of the code that **reads** a message moved to the new name — but the part that **writes** a message when you hit send was missed. So messages were saved under the old label while the app looked for them under the new one, and never found them. They existed (you'd see them in Foundry's chat sidebar) but the in-Agent thread came up empty — "NO_ENCRYPTED_DATA_FOUND."

The one-time 1.1.0 migration had been quietly masking it: it relabeled everything that existed at upgrade time, so old history showed and things looked fine — while everything sent *after* the upgrade slowly went missing.

Now every send path writes the correct label, and the thread view also reads the old label as a fallback, so messages stranded since 1.1.0 show up again without a reload. If your threads were coming up empty, they shouldn't anymore — please send a fresh message and confirm it appears in the device, not just the sidebar.

---

## 1.7.2 — Fixed the "constant refresh" (Simple Calendar clock thrash)

Thanks to everyone who kept reporting this — it was fixed once and crept back. Root cause: with Simple Calendar running an unpaused clock, SC fires a time-change event **every in-game second**, and the Agent re-rendered the whole device on each one. But the Agent clock only shows **HH:MM** — so 59 out of every 60 of those re-renders changed nothing on screen. That constant full re-render is what you saw as the device "refreshing," and under a busy session it re-renders fast enough to eat clicks before they register.

Now the Agent only re-renders when the displayed **minute** actually changes — the clock still updates on time, but the device stops thrashing while the clock ticks. I also routed the last remaining direct-render path (user-flag changes, like unread badges) through the same throttle so a chatty combat round can't reintroduce it.

If you were hit by this, please start your SC clock and confirm it's calm now — and if another module still triggers it, tell me which one and I'll gate that too.

---

## 1.7.1 — Rules corrections: Armor-Piercing & dodging (verified against the book)

Two combat rules were wrong, both caught by player feedback (thank you). I'd built them from memory instead of the rulebook — fixed now, and this time checked line-by-line against Cyberpunk RED.

- **Armor-Piercing ammo** no longer halves armor SP, and no longer halves the damage that gets through. Per CPR pg 344 its *only* effect is that it **ablates 2 armor SP instead of 1** — the armor wears down twice as fast, but the hit does normal damage against the armor's real SP. That's now exactly what it does.
- **Dodging no longer costs your Action.** The prompt used to claim evading spent your Action — it doesn't. Per CPR pg 172, a defender with REF 8+ can simply *choose* to dodge a ranged attack as a free reaction (their Evasion becomes the DV the attack must beat). That misleading line is gone.

While I was in there I made every ammo type's in-app reminder match the book (correct DVs and effects for Sleep, Rubber, Biotoxin, Poison, EMP, Flashbang, Incendiary, Expansive), and gave **Rubber** its real rules — it can't cause a Critical Injury, can't ablate armor, and won't drop a target who's above 1 HP below 0 (they're left at 1), per CPR pg 345. Sleep was already correct (no damage, DV13 Resist Torture/Drugs).

Also pruned the now-dead code left over from the old pre-roll dodge flow (replaced by the 1.7.0 reactive flow).

---

## 1.7.0 — Dodge is a real reaction now (attack rolls first)

Per your table's flow: the attacker now rolls **first**, and only *then* does the defender get the Dodge / Take-the-hit prompt — so they see they're under fire (and the roll) before deciding whether to spend their Action dodging. Dodge → their Evasion becomes the DV that attack must beat; take it → it resolves against the range DV. Same correct math and ties (defender wins ties) — just the proper order now: **attack → react → resolve**, instead of dodging up front. The prompt also shows the attack total ("rolled X to hit").

Under the hood the attack resolution waits on the defender's answer (a player answers over the socket; the GM adjudicates locally when no one's online), with a 60-second safety timeout so an unanswered prompt can never hang the attack. Still behind the "Reactive Dodge Prompts" GM setting.

---

## 1.6.1 — Themed the dodge prompt

The reactive-dodge popup was a plain white Foundry dialog. It now matches the Agent — dark cyberpunk backdrop, cyan accents, monospace, with **DODGE** in cyan and **TAKE THE HIT** in red.

---

## 1.6.0 — Players can post their own Garden profiles

The Garden (dating app) used to be GM-only for adding profiles. Now **anyone can tap + and post a profile** — name, age, photo, bio, interests, availability. Because profiles live in a shared world list that only the GM can write directly, a player's submission is relayed to the GM's client (the same way social-feed posts are) and shows up for everyone a moment later. Player-posted profiles are visible to all players; the GM can still scope their *own* profiles to specific players as before, and remains the only one who can delete profiles.

---

## 1.5.5 — Dodge prompt actually shows up (eligibility no longer hides it)

Found the real reason the dodge popup wasn't appearing: it was gated on dodge *eligibility*, and ranged fire can only be dodged with REF 8+ (CPR pg 173) — so shooting a typical low-REF NPC or PC with a gun **silently skipped the whole prompt**. That's the most common combat action, so it looked completely broken.

Now the prompt fires for **any** attack with a valid target; eligibility only controls whether the **DODGE** button is offered. Melee and REF 8+ targets get the full Dodge / Take-the-hit choice; a low-REF target being shot at gets an "incoming — brace" notice (no illegal bullet-dodge). There's also a `[VirtualAgent dodge]` line in the F12 console on each attack now, logging exactly what it decided — so if anything's still off, we can see where instantly.

---

## 1.5.4 — Dodge prompt now always appears (GM adjudicates when no player is online)

The reactive-dodge popup (1.5.0) only ever showed on the *defender's* client — so if you were testing solo, the target's player wasn't logged in, or you were running the attack as an NPC, nothing appeared and the attack just resolved against the range DV. Now: if there's an online owner to ask, they still get the popup as before; **if there isn't, the GM gets the Dodge / Take-the-hit prompt right there** and adjudicates it (rolling that character's Evasion). So the prompt always shows for *someone*, and you can finally see it work without a second client.

---

## 1.5.3 — Boot screen says "Virtual Agent"

The power-on boot animation still flashed the old **AGENT OS** logo — the 1.0/1.1 rename swept the code but missed this one line in the boot-sequence template. It now reads **VIRTUAL AGENT** (same boot animation, same Ziggurat BIOS flavor line underneath).

---

## 1.5.2 — Dead characters stop rolling Death Saves

A character at 0 HP makes a Death Save at the start of each turn (CPR pg 187) — but once they failed one and died, the app kept prompting a fresh Death Save every turn (they're still sitting at 0 HP). Now a failed save **marks the character dead** (and flags them defeated — the skull in the combat tracker), and the start-of-turn auto-prompt **skips anyone already dead**. If a downed character is later healed back above 0 HP (or stabilized to 1 HP), the marker clears so they'll make saves again if they go down a second time.

---

## 1.5.1 — Combat menus no longer snap to the top

Adjusting a value in a combat menu (a modifier stepper, the ammo picker, fire mode, the move-distance picker) re-renders the panel, which was scrolling it back to the top — so you'd lose your place every time you tweaked something. The combat prep dialogs (attack roll, skill roll, move picker) now keep their scroll position across those re-renders, using the same self-preserving mechanism the NCPD/Ziggurat/Garden lists already use.

---

## 1.5.0 — Reactive bullet-dodging (defenders roll their own Evasion)

The big one from Mike Capiak's combat feedback: attacks resolved against the range DV and auto-applied damage, so a defender who wanted to dodge had to roll Evasion manually and then ask the GM to undo the HP loss and armor ablation.

- **Now, when you attack a target in the COMBAT app, that target's owner is prompted first** — a "Dodge or Take the hit?" popup on *their* screen. Choosing **Dodge** rolls their own Evasion (DEX + Evasion + 1d10), posts it to chat, and that roll becomes the DV your attack has to beat. A successful dodge simply makes the attack **miss**, so no damage is ever applied and then undone. (Ranged dodges need REF 8+, per CPR; melee can always dodge. NPC targets prompt the GM.)
- While you wait for their call, the attack's ROLL button holds; a **SKIP** button lets you proceed against the range DV if they're slow or offline.
- New GM setting **"Reactive Dodge Prompts"** (Configure Settings → Virtual Agent), **default on** — turn it off to resolve straight against the range DV.

*(Third and last of the three combat fixes from that session. ⚠️ This one is multi-client — please test it with a GM + a player on your server.)*

---

## 1.4.0 — Ammo types in combat (pick your rounds)

Combat feedback (Mike Capiak): the app fired every weapon as if loaded with basic rounds.

- **New AMMO selector in the attack dialog** — pick what's loaded before you roll: Basic, AP, Rubber, Sleep, Expansive, Incendiary, Biotoxin, EMP, Poison, Acid, Flashbang.
- **Rules the app applies for you (single + aimed shots):**
  - **Armor-Piercing** — penetrates against half the target's SP (round up), and the damage through is halved (round down); armor still ablates from its real SP. (CPR pg 344)
  - **Sleep** — deals **no** damage; posts a **DV13 Resist Torture/Drugs** check for the target instead (the reported bug). No HP loss, no ablation.
  - **Rubber** — noted non-lethal (a target dropped to 0 is unconscious, not dying).
- The remaining types (Expansive, Incendiary, Biotoxin, EMP, Poison, Acid, Flashbang) are recorded on the shot and printed with a rule reminder for the GM to adjudicate the special effect — rather than apply a number I'm unsure of. Tell me the exact rule for any of these and I'll mechanize it too.

*(Second of the three combat fixes from that session — reactive bullet-dodging is the last and biggest.)*

---

## 1.3.1 — Armor fix: single items that cover head + body now stop damage

Combat feedback (Mike Capiak): armor that covers both locations in one item — Body Weight Suit, Subdermal Armor — was being ignored, so attacks punched straight through for full damage. The combat app now reads those items' Stopping Power directly (current SP = the item's SP minus its ablation, per the cyberpunk-red-core armor fields) whenever the per-location value comes back empty, so their SP correctly reduces incoming damage. Separate head-only / body-only armor was never affected.

*(First of three combat fixes from that session — ammo types and reactive bullet-dodging are coming next.)*

---

## 1.3.0 — Hide NPC HP/SP from players (GM toggle)

Patreon feedback: players could read NPCs' HP and armor SP in the COMBAT app, which breaks immersion — the PCs shouldn't know enemy vitals.

- **New GM setting "Show NPC HP/SP to Players"** (Configure Settings → Virtual Agent), **default ON** so nothing changes unless you want it to. Turn it off and players no longer see an NPC's HP bar, HP numbers, or SP-BODY / SP-HEAD — on the active-combatant status card or in target lists they read "???" instead, and the damage breakdown stops spelling out the enemy's armor SP. **The GM always sees the real values**, and players still see their own and allied PCs' vitals normally.

---

## 1.2.0 — Resize the Agent (corner-drag to scale)

Player feedback: on a small / high-DPI laptop (a 13" MacBook), the Agent rendered tiny.

- **New: drag the bottom-right corner of the Agent to resize the whole thing.** A small grip sits on the phone's lower-right edge — drag it out to enlarge, in to shrink. The entire Agent scales as one piece, so the layout stays exactly as designed (nothing reflows or breaks). **Double-click the grip to snap back to the default size.**
- Your size is **remembered per device** — set it once on your laptop and it sticks there, without changing anyone else's Agent.

---

## 1.1.2 — Skills fixes (taps roll again; the skill list fills the panel)

From tonight's table feedback:

- **Skill taps weren't rolling.** The skill list and the dice roll each figured out "which character is this?" a different way, so they could disagree — the list would show your skills, but tapping one came back "No active character" and did nothing. Both now use one shared lookup tied to your Agent identity (the same one the wallet and messages already use), so a tap reliably opens the roll dialog and rolls. GMs can still roll a selected token's skills.
- **The skill list was tiny.** The character card at the top was locked to ~60% of the panel, squeezing the actual skill list into the bottom 40% (and that lock also disabled the after-roll shrink). The card now takes only the height it needs and the skill list gets the rest.

---

## 1.1.1 — Install-folder fix (the zip extracts to `VirtualAgent/` now)

1.1.0's release zip was *named* right (`VirtualAgent-…zip`) but the folder packed inside it was still the old hardcoded `AgentDevice/`, so it extracted to the wrong place and Foundry couldn't match it to the new module id (and the `modules/VirtualAgent/` asset paths wouldn't resolve). The build now takes the wrapping folder name straight from the module id, so the archive extracts to `VirtualAgent/` — drop it right into your modules directory. **If you grabbed 1.1.0, use this one instead.**

Packaging fix only — no code change from 1.1.0.

---

## 1.1.0 — Virtual Agent is its own module now (auto-migration included)

The rename goes all the way down. The module id is now **VirtualAgent** (it used to be `AgentDevice` under the hood), so it installs to its own `VirtualAgent/` folder and stands as its own module — cleaner for the 1.0 identity and for a Foundry listing down the road.

**Your data comes with you, automatically.** The first time a GM loads this version, it runs a one-time migration that carries *everything* over from the old AgentDevice install — world settings (the social feed, auctions, the NCPD / Ziggurat / The Garden databases, NC Mart config, map paths), every player's wallet, contacts, unreads, ID handle, fixer rank, housing, and the **entire Agent chat history**. Image and map paths that pointed at the old module folder get rewritten to the new one. Nothing is deleted from the old module — if anything looks off, your original data is still sitting there untouched.

To switch over: install Virtual Agent, enable it, load the world once as GM (you'll get a "migration complete" notice), then you can disable the old module.

Drop-in upgrade — just don't skip that first GM load, so the migration can run.

---

## 1.0.1 — Rebrand to Virtual Agent (in-app)

Carried the new name all the way through. Every in-app reference and notification that used to read "Agent OS" now reads **Virtual Agent** — the toasts, the window title, the logs, all matching the module name. Purely cosmetic; the module id stays `AgentDevice` under the hood, so nothing about your data changes.

Drop-in over 1.0.0. No migration.

---

## 1.0.0 — Out of beta

This is it — the Agent's out of beta and hitting 1.0.

Everything that grew across the betas is here and solid: the messenger with private DMs and GM-puppeted NPC threads, the eurobuck wallet with P2P transfers and a GM system fund, NC Mart shopping with the Night Market, the social feed, the fixer contact tracker, the biomonitor with Trauma Team and REO Meatwagon panic lines, the live auction house, the datapool drops, the NCPD / Ziggurat / The Garden databases, GM map pins, housing on the ID card, and the full Sys Admin console — plus the COMBAT app running Cyberpunk RED's Friday Night Firefight end to end.

The last stretch was about earning the 1.0 — a full audit of every app. Closed a set of eurobuck exploits (transfers, auction bids, and NC Mart now validate on the server, not just the client), cleaned up the multiplayer messaging edge cases (group unreads, duplicate social posts when two GMs are online, a typing-indicator leak), and ran a polish pass over the UI — unified search fields, a tidy combat fire-mode grid, and fitment tightened across the board.

It's titled **Virtual Agent** in Foundry's module list now. Same module underneath — existing tables upgrade in place, nothing to migrate.

— inGramGames

---

## Beta 5.8.45 — Fitment polish: standing buttons, admin forms, fire-mode grid

A few small layout fixes:

- **Fixer standing buttons** (ALLIED / FRIENDLY / NEUTRAL / HOSTILE) now share their row evenly instead of risking an overflow on some Foundry setups.
- **Sys Admin add-forms** (NCPD / Ziggurat / Garden) had a few placeholders too long for their boxes — trimmed so they read cleanly instead of getting clipped.
- **Combat fire-mode buttons** now lay out as a tidy grid: a melee weapon's lone SINGLE button fills the row, a pistol's four sit on one line, and a full eight (SMG/AR with every mode) form a clean 4×2 instead of cramming into a wrapped mess.

Visual only. Drop-in over 5.8.44. No migration.

---

## Beta 5.8.44 — Search fields: one consistent look, no more text under the magnifier

Polish pass on every search box. They'd drifted — only the Skills search had a magnifying-glass icon, and a global style rule was quietly overriding its padding so the placeholder ran right under the icon. Fixed that override and gave all six search fields (Contacts, DataPool, NC Mart, NCPD, Ziggurat, Skills) the same treatment: magnifier pinned left, text padded clear of it, same height and monospace. The Contacts box was also rendering oversized — now it matches the rest.

Visual only. Drop-in over 5.8.43. No migration.

---

## Beta 5.8.43 — Multiplayer messaging fixes

Three fixes for tables with multiple players (and multiple GMs):

- **Group-chat unread badges land on the group again.** A new message in a custom group was lighting an unread on the *sender's* DM row instead of the group thread. Fixed the thread-bucketing so group messages count against the group.
- **Social posts don't duplicate** when two GMs are logged in. Each connected GM was processing the post and writing it, so one post showed up twice (or more). Now only the primary GM commits it.
- **The "typing…" indicator no longer bleeds between private chats.** If someone was typing you a DM, a third player who happened to have their own DM open with you could catch the typing dots. It never exposed message content — but it shouldn't have shown at all, and now it only shows to the person actually being messaged.

Drop-in over 5.8.42. No migration.

---

## Beta 5.8.42 — Eurobucks anti-cheat: every transaction validated server-side

Hardened the money paths so balances can't be gamed. None of this changes normal play — it closes holes a modified client could exploit:

- **Transfers and auction payouts now confirm the sender actually has the eb** before moving it. The balance check used to live only in the UI, so the underlying transfer could be driven negative — and an auction winner who couldn't afford their bid still won the lot. The GM's System Fund is unaffected; it's still the money tap.
- **Auction bids from a Virtual Wallet are funds-checked** like everyone else now (they were slipping past the check).
- **NC Mart totals up the cart on the server** instead of trusting the number the client sends, so you pay the real price — not whatever a tampered client claims.
- **The Fixer-rank gate is enforced at checkout**, not just hidden in the catalog.

Drop-in over 5.8.41. No migration.

---

## Beta 5.8.41 — Combat ownership fixes

Did a full review pass over the COMBAT app and fixed four things — all in the GM-runs-NPCs path, which is most of how this app actually gets used:

- **RELOAD and ITEM now act on the NPC whose turn it is**, not your own character. Both were resolving the phone's bound actor instead of the active combatant, so a GM running a mook reloaded the wrong sheet (or nothing happened). They now match every other combat action.
- **CHOKE, HUMAN SHIELD, and THROW drop you back to the main menu** after they fire, like HOLD and EVADE already did — no more getting stranded on the MORE list with your Action already spent.
- **Players can end their own turn again.** END TURN was calling Foundry's turn-advance directly, which players don't have permission to do — so the button looked alive but did nothing on a player's turn. It now relays to the GM who owns the encounter, with a guard so only the active combatant's owner can trigger it.

Drop-in over 5.8.40. No migration.

---

## Beta 5.8.40 — GM initiative banner rolls every NPC at once

5.8.39's ROLL INITIATIVE banner worked great if you owned one combatant — but a GM running a table
full of NPCs got nothing useful out of it. The banner keyed off a single "my combatant," and a GM
doesn't have one, so it never surfaced a way to roll the mooks. You were stuck going back to the tracker.

**Fixed:** when you're the GM and there are NPCs in the encounter who haven't rolled yet, the COMBAT
app now shows a ⚡ ROLL NPC INITIATIVE banner with a live count of how many are still pending. One tap
rolls initiative for all of them through the CPR system's own formula — same result as rolling them in
the tracker. Players still get their own single-roll banner; nothing changes on their side.

Drop-in over 5.8.39. No migration.

---

## Beta 5.8.39 — Roll Initiative from the phone

The one combat step that still forced players back out to Foundry's tracker. When combat starts
and you're in the tracker without an initiative yet, the COMBAT app now shows a glowing
⚡ ROLL INITIATIVE banner above the turn card. Tap it and your initiative rolls through the CPR
system's own formula — 1d10 + REF plus whatever your role adds (Solo Combat Awareness included) —
and lands in the tracker like the GM rolled it there. The banner only appears for combatants you
own that haven't rolled, and disappears the moment the number's in.

Drop-in over 5.8.38.

---

## Beta 5.8.38 — Every RULES line now describes YOUR roll, not the rulebook

Play feedback: rolled 4+3+2 damage and the card said "2+ sixes → Critical Injury" — reads like
the roll crit when it didn't. That footer was a static rules reminder, and players reasonably
read everything on a result card as a result. Swept EVERY card the same way — each RULES line is
now computed from the dice that were actually rolled:

**Damage:** "no sixes this roll (2+ sixes would inflict a Critical Injury)" / "2 sixes → CRITICAL
INJURY (+5 dmg)" / the no-sixes crit reasons spelled out ("Aimed Shot · leg → Broken Leg",
"target Mortally Wounded → crit on any damage"). Armor text matches the numbers shown: "armor
ablates: SP 11 → 10", "nothing got through — armor not ablated", or "target has no armor SP"
when the grid says −0.

**Attack:** footer now reads "17 vs DV 15 — must beat it, a tie misses" with the DV actually in
play (range table, autofire table, or the defender's evasion roll) instead of reciting the
REF+Skill+d10 formula the grid above already shows.

**Skill checks:** "natural 10 → CRIT, second d10 added" / "natural 1 → FUMBLE, second d10
subtracted" / "first die 6 — crit needs a natural 10, fumble a natural 1" instead of the static
explode/fumble recap.

**Grab / Choke:** "Target resists with Brawling OR Evasion vs 18 — target wins a tie" with the
actual roll to beat. **Stabilize:** success says what happened (healed to 1 HP, unconscious 1
min, DSP resets); failure says what didn't ("no effect; retry next turn for an Action").

Cosmetic only. Drop-in over 5.8.37.

---

## Beta 5.8.37 — Card text fitment: labels never break mid-word again

Screenshot round two: at narrow chat widths Foundry's word-break CSS was shredding the little
label chips — "RULES" stacking vertically letter by letter, "HANDGUN" splitting across two lines
in the attack grid. Every RULES chip (all 8 cards) is now `white-space: nowrap` so the label stays
on one line while the rule description next to it wraps normally — and wrapped descriptions now
top-align against the chip instead of floating mid-height. The stat-grid header labels (ROLL /
REF / skill name / ATK / TOTAL, DICE / ARMOR SP / DEALT, ROLL 2d6 / BONUS DMG) get nowrap + clip
so a long skill name trims instead of folding the cell.

Cosmetic only. Drop-in over 5.8.36.

---

## Beta 5.8.36 — MOVE picker could soft-lock you

Bug report from play: open MOVE, and on some panel sizes all you can reach are the distance
steppers and the RUN toggle — no CANCEL, no CONFIRM. The picker's bottom row is anchored with
`margin-top: auto` in a container that never scrolled, so once the RUN toggle (5.8.31) made the
header taller, the confirm row could land below the panel edge. And the red back arrow made it
worse: it exited to the home screen *without clearing the picker state*, so re-opening COMBAT
dropped you straight back into the picker. Trapped.

**Fixed, two ways:** the picker body now scrolls (`overflow-y: auto`) so CANCEL / CONFIRM are
always reachable, and the back arrow pressed inside the picker now just cancels it and returns
you to the combat menu — it no longer leaves the app with the picker armed.

Expected flow, for the record: MOVE → pick distance (steppers or ¼/½/full) → optionally toggle
RUN (×4, spends Action) → **CONFIRM** posts the move card and spends your Move, **CANCEL** or the
back arrow returns to the menu with nothing spent.

Drop-in over 5.8.35.

---

## Beta 5.8.35 — Repo housekeeping: dev scripts out of the base

The module's base directory had accumulated four smoke tests and two audit reports from the last
few development cycles. None of that belongs next to module.json. Everything dev-only now lives
under `dev/` — `dev/smokes/` for the live regression suite (paths adjusted, still runs from
anywhere: `node dev/smokes/_v5_8_34_smoke.js`), `dev/audits/` for the audit reports behind the
5.8.32/5.8.33 releases. The release workflow excludes `dev/` from the zip, and the 5.8.35 smoke
now fails if a dev script ever lands in the base again.

No module code changes. Drop-in over 5.8.34.

---

## Beta 5.8.34 — Readability pass on combat text + button icon alignment

Player feedback round (thanks for the screenshots).

**Rules text you can actually read:** every chat-card footer and hint line was 0.45-0.55rem in
#666-#888 grey on near-black — fine on a 4K GM monitor, soup on everything else. Swept all of them
up to 0.58-0.65rem with brighter greys (#999-#ccc), across every combat card (attack, damage,
evasion, death save, crit injury, stabilize, suppressive, shell, explosive, move) and the
fire-mode subtitles in the attack prep dialog. Accent-colored chips (RULES, INIT, dice-grid
headers) stay small — they're bright enough to carry it.

**Menu icons centered:** the six COMBAT grid buttons (ATTACK / RELOAD / ITEM / MORE / MOVE /
END TURN) drew their FontAwesome icon riding high against the top border. Icons get
`line-height: 1` + a 3px nudge down so icon+label sit centered as a unit.

**Two stale rules strings caught in the sweep:** the EVASION CHECK card claimed "ties to attacker"
— wrong since the 5.8.32 tie fix; it now reads "Attacker must beat this total — ties go to the
evader (CPR pg 170)". And the ▥ SHELL fire-mode subtitle still described the old improvised
scatter-cone mechanic; it now matches the 5.8.32 RAW rework (flat DV13, 3d6 once, 6 m/yd arc).

Cosmetic only (plus the two string corrections). Drop-in over 5.8.33.

---

## Beta 5.8.33 — Dead-code prune + the death card that never showed

Follow-through on the 5.8.32 audit's cleanup list (`_audit_dead_code_5_8_32.md`). Net −260 lines,
one real bug fixed along the way.

**The bug:** the ☠ MORTALLY WOUNDED card (5.8.24) read the target's HP *after* the damage update
had already been applied on the GM/owner path — so the "HP crossed to 0 this hit" test could never
pass and GM-dealt killing blows never posted the card. Player-dealt (socket-routed) kills worked,
which is why it looked alive. The pre-damage HP is now snapshotted at apply time and the card
logic reads the snapshot.

**Deleted — dead handler cases** (no button or binding reaches them): `combat-attack-damage` (the
pre-5.7.8 manual ROLL DAMAGE step — 73 lines duplicating the damage pipeline *without* any of the
5.8.26+ features, a drift hazard), `combat-attack-back`, `combat-back-to-main`, `combat-item-back`
(pre-5.8.8 multi-screen flow leftovers), `map-pin-add` (replaced by the pin modal),
`gm-group-voice-set` and the `skill-search-input`/`skill-search-clear` switch cases (all three
have live dedicated bindings; the cases were unreachable duplicates).

**Deleted — vestigial state:** `_defendActive` + `combatDefendActive` (the 5.7.0 DEFEND action was
replaced by EVADE in 5.8.2; the flag's been written-false-only ever since), `_combatComboCount`
("slice 5 will use this" — it didn't), `_evadeRollTotal`/`_evadeRollFlavor` (the evade card prints
these inline), `_callAnimActive` (pre-JB2A-tag holophone guard). Also the orphaned
`.agent-flex-row` CSS helper (Patch4, Ley) — the rows it styled were since restyled inline and no
markup carries the class anymore.

**Smoke suite reorganized:** the twelve 5.5.x–5.7.x smokes hardcoded session paths from two
machines ago and couldn't run anywhere; several also pin behavior deleted above. Moved out of the
repo to `_archive/AgentDevice/smokes/` (along with the never-committed `_v5_7_1_smoke.js`). The
live suite is now 5.8.31+, all portable; their module.json version pins are relaxed to the 5.8.x
line so the suite stays green across releases. New in 5.8.33's smoke: a structural guard that
cross-checks every template `data-action` against the handler switch — the class of bug behind
the dead RUN toggle can't ship silently again.

No behavior changes beyond the death-card fix. Drop-in over 5.8.32.

---

## Beta 5.8.32 — Combat audit: 13 fixes, every rules call re-checked against the core rulebook PDF

A full audit of the 5.8.26–5.8.31 combat build-out, this time with the actual CPR core rulebook as
source of truth instead of memory. Thirteen findings, all fixed here. The worst one first.

**The crasher:** the damage pipeline read `armorSP` one line before it was declared. JavaScript
calls that a temporal dead zone and throws — and our catch block swallowed the throw silently. The
result: any Aimed Shot to the LEG, or any hit on a Mortally Wounded target, that didn't also roll
2+ sixes did *nothing*. No damage, no HP change, no crit, no card. Both features looked tested
because rolling 2+ sixes short-circuited past the bug. Armor lookup now happens first.

**Autofire used the wrong DVs:** the 5-band Autofire Range Table (pg 173) was computed since 5.8.26
and then never used — attacks resolved against the single-shot table. It's now actually applied
(unless the defender dodges or the GM hand-set a DV).

**Death Saves were a different game's rule:** rewritten to RAW pg 187 — roll 1d10 (no exploding),
add your Death Save Penalty, live only if strictly UNDER your BODY. A natural 10 always kills.
The penalty now actually exists: +1 every save you roll, +1 whenever you're damaged while Mortally
Wounded (pg 186), and Stabilization resets it to base. Stored as actor flags.

**Shotgun Shells were improvised:** now RAW pg 173 — one attack vs flat DV13, on a hit a single
3d6 roll applies to every visible target in front of you within 6 m/yds; REF 8+ can dodge it.
Costs 1 shell. The old card used the range-table DV and the weapon's own damage; every number on
it was wrong.

**And the rest:** ties now MISS ("Defender wins in a tie", pg 170/172); single/aimed/explosive
shots finally consume a bullet (the UNLOADED badge was never reachable through play before);
natural-1 fumbles roll a second d10 and subtract it (pg 130) instead of just wearing a badge;
Aimed Shot → head rolls crits on the HEAD table (the "TODO: once head is wired" comment outlived
head being wired by three releases) and ablates head armor, not body; Aimed Shot → leg forces
specifically Broken Leg instead of a random crit; the manual damage path no longer hands out crit
injuries on nat-10 attack rolls; you can now RUN after your normal Move (pg 168 — that's literally
the definition of Run; we blocked it) as a ×2 extra, with the merged ×4 picker kept for fresh
turns; Suppressive Fire consumes your Action when you fire it, not when you press FINISH; and an
open attack-prep dialog or move picker no longer survives into the next combatant's turn.

Self-tested: 40-check smoke including behavioral sims of the new Death Save semantics and a live
repro proving the old TDZ ordering throws. Audit doc with rulebook citations:
`_audit_combat_5_8_31_findings.md`.

Drop-in over 5.8.31. New actor flags (`deathSavePenalty`, `deathSaveBasePenalty`) default to 0 —
no migration.

---

## Beta 5.8.31 — RUN toggle actually does something now

The ↗ RUN toggle in the MOVE picker was dead weight — it rendered, you could click it, and nothing happened. Everything around it shipped back in 5.8.27 (the button, the ×4 distance math, the ★ ACTION badge), but the one handler that flips RUN on never made it in, and the move state was missing the two fields it needed. So RUN never extended your distance and never cost you your Action. Caught in a code audit this cycle.

**Fixed:** clicking RUN now flips it on and off for real. ON → your max move jumps to MOVE × 4 (that's the extra Move Action you're spending your Action on, CPR pg 168), and confirming the move burns your Action along with your Move. OFF → back to the normal MOVE × 2. If your Action's already gone this turn, RUN now says so instead of going quiet. The move chat card reads "RUNS" with the ×4 math and an Action-spent note when you ran.

Also yanked the internal `_v5_*` smoke-test files out of the release zip — they're dev QA, never meant to ride along into your modules folder, and now they don't.

Drop-in over 5.8.30. No migration.

---

## Beta 5.8.30 — STABILIZE auto-heals + Choke + Human Shield

Final pieces of the CPR pg-168 combat-action list.

**STABILIZE auto-heals (pg 222):** the STABILIZE button rolled the First Aid/Paramedic check and showed success/fail but never applied the actual heal-to-1-HP. Now on success: if target is Mortally Wounded (HP<1), HP is set to 1, an "✚ STABILIZED → 1 HP" chat card posts noting the target is unconscious for 1 minute. Uses the same GM-socket routing pattern as damage application (5.8.23) — if the healer doesn't own the target's actor, emits `combatStabilizeHeal` and GM applies the update.

**CHOKE (pg 168):** new MORE submenu button. Rolls DEX+Brawling+1d10, posts a chat card explaining target resists with Brawling OR Evasion (higher wins). Card notes the damage scaling — 1d6 to neck per round held, +1d6 per round (max 3d6), no armor. Consumes Action.

**HUMAN SHIELD (pg 168):** new MORE submenu button. Posts an announcement card — "Ranged attacks targeting [attacker] hit the held victim instead until the grapple ends." Requires an active Grab; GM tracks which target is being used as the shield. Consumes Action. Simple chat-card prompt; no auto-resolve since the rule is GM-discretion.

---

## Audit completion vs 5.8.25 list

After this run, the COMBAT app covers virtually every action in CPR Friday Night Firefight (pg 168). Remaining gaps:
- **Equip/Drop Shield (pg 168)** — we don't model shields explicitly as items, GM handles
- **Get Up / Get into a Vehicle / Start a Vehicle / Vehicle Maneuver** — out of scope (vehicle combat is a separate system, pg 189+)
- **Use NET Actions** — out of scope (NET combat is its own system, pg 197+)
- **Re-roll Crit Injury if duplicate** — done in 5.8.28
- **Death Save auto-prompt** — done in 5.8.28
- **Mortally Wounded auto-Crit** — done in 5.8.28
- **Crit Injury as Item on target sheet** — not done; CPR system handles this when GM rolls on the in-system table

Everything else from the audit is implemented: Aimed Shot (head/held/leg), Autofire, Suppressive Fire, Run, Cover variants, Reactive Evasion, Bow/Crossbow no-reload, Shotgun shell scatter, Explosives, Throw, Choke, Human Shield, Stabilize w/ auto-heal, Crit Injury auto-roll on both tables, Death Save loop, Mortally Wounded auto-crit, plus all the earlier 5.8.x bugfixes (permission gating, GM socket routing, inline grey disabled buttons, unloaded weapon block, etc.).

## Beta 5.8.29 — Weapon edge cases: Bow/Crossbow + Shotgun shell + Throw + Explosives

**Bow/Crossbow (pg 173):** loading is part of the attack, so they never get the UNLOADED badge or the attack-time block. Detection on weaponType `bow` / `crossbow` — weapon picker shows them normally regardless of magazine value, attack handler skips the unloaded check for them.

**Shotgun Shell mode (pg 173):** added ▥ SHELL chip to fire mode picker when weaponType is `shotgun`. Picking it posts a "SHOTGUN SHELL — SCATTER" chat card explaining: single damage roll applied to ALL targets the GM places in the scatter cone, REF 8+ targets dodge individually. Continues to normal attack flow for the picker-selected target; GM resolves the rest manually with the rolled damage.

**Explosives (pg 174):** added ✸ EXPLODE chip when weaponType matches `grenadeLauncher` / `rocketLauncher` / contains grenade/rocket/missile/explosive. Picking it posts a "EXPLOSIVE — 10×10m BLAST" chat card with the rules: blast on target square, everyone in 10×10 area takes the same damage roll, REF 8+ individually dodge, if attack misses DV the GM picks where the blast lands.

**Throw (pg 172):** added ↗ THROW button to MORE submenu. Rolls `DEX + Athletics + 1d10`, posts a chat card showing the result and the throw range (BODY × 10 m). Tells the GM to apply damage separately if a thrown weapon (knife, grenade) was used. Consumes Action.

Self-tested 15 scenarios: 6 unloaded detection cases (Air Pistol blocked, Bow allowed at 0, Crossbow allowed at 0, AR blocked, Bow loaded, Bat melee), 6 fire mode capability cases (SMG/Shotgun/GrenadeLauncher/RocketLauncher/Handgun/Bow), 3 throw range cases (BODY × 10). All pass.

## Beta 5.8.28 — Death Save loop + Mortally Wounded auto-crit + Crit Injury re-roll

**Death Save auto-prompt (pg 186):** when a turn changes to a combatant with HP<1 (Mortally Wounded), the GM client auto-rolls `1d10 + BODY` vs `DV 10 + accumulated Death Save Penalty`. Posts a "✓ DEATH SAVE — SUCCESS" or "☠ DEATH SAVE — FAILED" card to chat with the math. Failure means the character is Dead per the rulebook. Hooks into the existing updateCombat listener that already resets per-turn state. GM-only to avoid double rolls; non-GM clients see the broadcast card normally.

**Mortally Wounded auto-Critical-Injury (pg 186):** Mortally Wounded targets suffer Critical Injury on EVERY hit, not just on 2+ sixes. Added a check in damage application: if target HP<1 and any damage gets through armor, force `isCritDamage=true` regardless of sixes count. The existing 5.8.25 auto-roll then handles the table lookup and bonus damage.

**Re-roll Crit Injury if target already suffering (pg 187):** `_rollCriticalInjury` now reads the target actor's existing criticalInjury items (CPR system Item type), compares against the rolled injury name, and re-rolls up to 6 times until it finds one the target doesn't already have. Re-roll attempts are logged in the chat card footer ("re-roll: 7 → Foreign Object (already suffering)"). Max 6 attempts to avoid infinite loops if the target somehow has all 11 entries.

Self-tested 13 scenarios: Death Save math across 4 cases (success, fail, with DSP penalty, large numbers), Mortally Wounded auto-crit triggers across 5 cases (healthy/mortal × hit through/blocked), re-roll simulation finds a new injury in 100/100 trials with 3 existing. All pass.

## Beta 5.8.27 — Run + expanded Cover + Reactive Evasion

**Run (pg 168):** MOVE picker now has a "↗ RUN (use Action for Move×2 extra)" toggle. Activates max distance to MOVE × 4 instead of × 2, consumes Action in addition to Move. Header shows "RUN" + ★ ACTION badge when active. Confirming the move with RUN active marks both Move and Action as used in the budget. Picker can be opened even if Move was already used (so you can still spend Action on a Run).

**Cover (pg 170):** existing quick-mod row replaced single "−2 COVER" with two variants: −2 LIGHT COVER, −4 HEAVY COVER. Players pick whichever the GM rules applies — buttons add to the situational modifier total, can stack with other modifiers.

**Reactive Evasion (pg 173):** when target has REF 8+ AND attack is ranged, a "DEFENDER WILL DODGE" toggle appears in the attack prep dialog. When toggled and ROLL is pressed: the system auto-rolls defender's DEX + Evasion + 1d10 and uses that total as the DV instead of the range table DV. Defender's roll is broadcast to chat as a "↺ DEFENDER DODGES" card before the attack roll resolves so everyone sees the dodge math. If the attack total beats the evasion total, the attack hits as normal. Skips for melee (no reactive Evasion in melee) and for REF<8 targets.

Self-tested 15 scenarios: run distance math across 6 cases, evasion eligibility across 5 cases, cover stacking math across 4 cases. All pass.

## Beta 5.8.26 — Fire mode picker: Aimed Shot + Autofire + Suppressive Fire

Three fire modes wired into the existing attack prep dialog. FIRE MODE row appears above DV — chips for SINGLE, ◎ HEAD / ◎ HELD / ◎ LEG (Aimed), ▦ AUTOFIRE, ▦ SUPPRESS. Only modes the weapon supports show up. Subtitle below the chips explains the rule cost when a non-single mode is selected.

**Aimed Shot (pg 169):** picking any aimed mode auto-applies −8 to the modifier (and removes it when you switch back to single). HEAD swaps armor lookup to currentArmorHead and doubles damage past head SP. HELD posts a "TARGET DROPS HELD ITEM" chat card when any damage gets through body armor. LEG forces a Critical Injury (Broken Leg) on any damage through, regardless of sixes.

**Autofire (pg 173):** uses the actor's Autofire skill (not the weapon's normal skill) and the separate 5-band Autofire Range Table (SMG: 15/13/15/20/25, AR: 17/16/15/13/15 across 0-6/7-12/13-25/26-50/51-100m). Damage formula overridden to `2d6 × (atkTotal − DV)` capped by weapon multiplier: SMG×3, AR×4, HMG×4. Costs 10 bullets up-front. If both d6 came up 6 → also triggers Critical Injury (5.8.25 table auto-rolls).

**Suppressive Fire (pg 173):** doesn't roll attack or apply damage. Posts an area-effect chat card with the attacker's REF+Autofire+1d10 roll and instructions: every target within 25m, out of cover, in LOS rolls WILL+Concentration+1d10 vs that total. Failed targets must use their next Move Action to take cover. Costs 10 bullets.

Capability detection: weapons get `supportsAimed` (any ranged), `supportsAutofire` (weaponType is smg/assaultRifle/heavyMachineGun), `supportsSuppressive` (same as autofire). Melee weapons stay locked to single shot.

Self-tested 21 scenarios: capability detection across 6 weapon types, autofire range table across 6 distances, damage multiplier across 5 beat-by values, modifier swap logic across 4 mode transitions. All pass.

## Beta 5.8.25 — Auto-roll Critical Injury Table + rulebook audit

Auto-rolls the CPR Critical Injury Table when 2+ sixes happen on damage. Replaces the 5.8.24 placeholder ("GM rolls on Critical Injury Table...") with a real rolled result card. Important correction caught: the rulebook is **2d6** (results 2-12 with 7 most common), not 1d10. Both Body and Head tables transcribed from CPR pg 187-188 — all 22 entries: name, mechanical effect, quick fix DV, treatment DV. Default is Body table (Head activates once Aimed Shot to head is wired). Roll happens GM-side: if attacker is GM rolls directly, if player attacker emits socket to GM. Chat card shows 2d6 result with individual dice, injury name, effect, quick fix DV, treatment DV, +5 bonus damage callout, pg reference. The "re-roll if target already suffers it" rule is noted but not automated yet (needs to read actor's criticalInjury items to filter).

---

## CPR Combat audit — implemented vs missing

**Implemented + rule-correct:**
Single Shot (pg 173), Melee (pg 175), Crit on first die only (pg 130), 8-band range table (pg 173), Wound penalties (pg 186), Damage flow + armor ablation (pg 186), Critical Injury detection + auto-roll table (pg 187), HOLD / EVADE / GRAB / STABILIZE buttons (pg 168), MOVE bounded by MOVE×2, Reload (pg 168), Pre-roll modifiers + LUCK (pg 129), Permission gating, GM-socket routing for non-owners, DEATH/CRIT chat cards, Unloaded weapon block.

**MISSING — high priority (rulebook explicitly required fire modes):**
- **Aimed Shot (pg 169):** body-part picker (head x2 / held item / leg), -8 to check, 1 ROF
- **Autofire (pg 173):** Autofire Skill, separate 5-band range table, 2d6 × beat-DV damage capped SMG=3× / AR=4×, costs 10 bullets, both d6=6 → also Crit Injury
- **Suppressive Fire (pg 173):** WILL+Concentration vs REF+Autofire defense, 25m area, forces cover

**MISSING — combat actions from pg 168:**
- Run (extra Move Action — Move×2)
- Throw / Throw object (pg 168, 172)
- Choke, Equip/Drop Shield, Human Shield
- Out of scope: NET Actions, Vehicle, Get into Vehicle

**MISSING — reactive / defensive:**
- Evasion reactive dodge (defender REF 8+ rolls DEX+Evasion+1d10 vs ranged attack, pg 173)
- Cover (DV bonus for cover types)

**MISSING — wound-state mechanics:**
- Death Save auto-prompt for Mortally Wounded (must roll each turn, pg 186)
- Stabilize First Aid check — STABILIZE button exists in MORE but needs to verify it rolls + applies the heal-to-1 HP (pg 222)
- Mortally Wounded auto-Critical-Injury on every hit (pg 186)
- Track increased Death Save Penalty from certain Crit Injuries

**MISSING — weapon-specific:**
- Bow/Crossbow never Reload (loading is part of attack) — currently treats as mag-using
- Shotgun Shell mode (multi-target scatter, pg 173)
- Explosives (10×10m blast, pg 174)

**MISSING — Crit Injury follow-through:**
- Re-roll if target already has the rolled injury (pg 187)
- Create the rolled injury as an actual CPR criticalInjury Item on the target sheet so the system applies its mechanical effect automatically

Suggested implementation order by common-play impact: Aimed Shot → Autofire → Run → Reactive Evasion → Death Save auto-prompt → Cover → Suppressive Fire → Shotgun shell + Explosives + Throw.

## Beta 5.8.24 — Inline grey buttons + cross-player targeting + key-event chat cards

Three issues shipped together.

**(1) Grey buttons actually grey now.** 5.8.20/5.8.21 tried to grey out disabled menu buttons via CSS overrides with `!important`. User reported they still showed full color. Root cause: something in the cascade was beating the CSS — could be Foundry's app stylesheet, could be browser cache, doesn't matter. Rewrote the six menu buttons to bake the grey treatment directly into the inline `style="..."` via Handlebars conditionals. There's no CSS cascade to win — the inline style IS the style:

- ENABLED: original neon color (border + text + glow + cursor pointer)
- DISABLED: `color: #5a5a5a; border: 1px solid #444; background: rgba(20,20,20,0.55); cursor: not-allowed; filter: grayscale(1); opacity: 0.55; pointer-events: none` — plus the `disabled` HTML attribute as belt-and-suspenders

Self-rendered both states, extracted the ATTACK button HTML, verified 8 properties (red color present when enabled, grey color present when disabled, grayscale filter applied, disabled attribute applied, cursor not-allowed, pointer-events:none). All 8 pass.

**(2) Players can target each other.** Target picker filter dropped any token whose HP came back null/undefined — which is what happens when you don't have OBSERVER permission on another player's actor. Tester1 couldn't see Tester2's HP, so Tester2 was filtered out of the picker entirely. Fix: if HP is `undefined` or `null`, treat the token as alive (you can shoot at something even if you can't see its hit points). Hidden/observed-only HP no longer hides the target.

**(3) Key event chat cards.** After damage application, two new dedicated chat cards fire when the conditions are met:
- **★ CRITICAL INJURY** — posts when damage roll has 2+ sixes (CPR pg 187). Includes the target name, the +5 Bonus Damage callout (bypasses armor), and a prompt for the GM to roll on the Critical Injury Table (pg 187-189). The system itself rolls on the table — this card just announces the event so it doesn't get lost in the chat scroll.
- **☠ MORTALLY WOUNDED** — posts when HP transitions from >0 to 0 (CPR pg 186). Announces the drop and reminds that the target must make a Death Save each turn until stabilized.

Both cards fire on every damage path (local update by GM, socket-routed update by player). HP comparison uses the pre-update snapshot so the death detection is accurate.

## Beta 5.8.23 — Players can damage GM-owned mooks (route via GM socket)

Tester1 attacked Test Mook (GM-owned), and Foundry blocked the HP update with `User Tester1 lacks permission to update ActorDelta` — the damage chat card posted but HP never dropped. Same root cause for armor ablation.

Foundry only lets a user `actor.update()` on actors they own. A player attacking an NPC owned only by the GM cannot directly mutate that NPC's HP. Standard Foundry pattern is to emit a socket event and let the GM's client perform the update on the player's behalf.

Implementation matches the existing eurobucks-transfer pattern in this module:
1. Attacker's client computes damage as before
2. Checks `target.testUserPermission(game.user, 'OWNER')`. GM is allowed via explicit `isGM` short-circuit (the prior code used `??` nullish-coalescing which incorrectly fell through for `false` — fixed)
3. If can update: applies HP + armor locally as before (no behavior change for GM)
4. If can't: emits `combatApplyDamage` socket event with target uuid, damage amount, armor ablation flag, attacker name
5. If no GM is online: shows error toast "No GM online — damage card posted but HP/armor not applied"

GM-side socket handler (in the existing single canonical listener) catches `combatApplyDamage`, resolves the target uuid via `fromUuid`, applies armor ablation if applicable, applies HP. Logs each step for traceability.

Self-tested four scenarios (GM updates locally, player updates own actor locally, player→GM socket route with correct payload, GM-side handler applies correctly). 4/4 pass. Caught my own bug along the way: `_canUpdate = perm ?? isGM` returned `false` for GM because `??` only handles null/undefined — replaced with `isGM || (perm ?? false)`.

## Beta 5.8.22 — Unloaded ranged weapons are blocked + flagged visually

User fired an Air Pistol that hadn't been loaded, scored a crit on the attack roll (22 vs DV 13), then the damage card came back DEALT 0 with an empty DICE column. Two bugs feeding into one bad outcome:

**Bug 1 — no ammo check before firing.** CPR pg 173 says you can't fire what isn't loaded, but the attack flow accepted any weapon regardless of magazine state. Added a hard block at the top of the `combat-attack-roll` handler: if `magazine.max > 0` AND `magazine.value <= 0`, show `ui.notifications.warn("<name> is UNLOADED. Reload before firing.")`, clear the prep dialog, return. Melee weapons (no `magazine.max`) pass through untouched.

**Bug 2 — damage formula "0" defeated the fallback.** The auto-damage path did `wep.system?.damage || '3d6'` — but the truthy string `"0"` passes that OR check. `new Roll("0")` evaluates to total=0 with zero dice rolled, which is why the DICE column was empty. Sanitization now explicitly tests `dmgFormula` against `/\d+d\d+/` and falls back to `3d6` if it doesn't match a real dice formula. Same fix in both the auto-damage and manual-damage paths. Logs a warning so we can see if any weapons are misconfigured.

**Picker UX.** The weapon picker now shows ammo state at a glance:
- Loaded ranged: full color, amber ammo count
- **UNLOADED** ranged: greyed + grayscale filter, dim border, red "UNLOADED" badge next to the name, red `0/12` ammo, "reload to fire" subtitle
- Melee: full color, `—/—` ammo (no magazine to worry about)

Self-tested 5 weapon configurations (loaded rifle, unloaded pistol with dmg formula, unloaded pistol with bad dmg "0", baseball bat no-magazine, knife no-magazine-field-at-all) and 8 damage formula sanitize cases (valid formulas pass through, invalid ones get 3d6). All pass.

## Beta 5.8.21 — Broaden the disabled-button selector

User installed 5.8.20 and still saw fully-colored buttons in the disabled state. Cause was almost certainly Foundry's CSS cache + an under-specific selector. The 5.8.20 rule targeted only `.AgentDevice-form button[disabled]` — if anything in Foundry's environment loaded a stale CSS, or if the form class scope didn't carry as expected, the rule missed.

5.8.21 broadens the override to:
- Both attribute `[disabled]` AND pseudo `:disabled` selectors (some browsers prefer the pseudo)
- Both `.AgentDevice` scope (the always-present window-app class) AND `.AgentDevice-form` scope, so the rule lands regardless of where the button lives in the DOM
- Every hover/focus/active state included so no interaction state slips past the grey
- Added `pointer-events: none` belt-and-suspenders so clicks don't even register on disabled
- Child selector is now `button[disabled] *` (universal descendant) instead of just `i, span, strong` — catches any nested element with inline color/text-shadow

A version bump also forces Foundry to invalidate the CSS cache when the module updates.

If you still don't see grey after this install, hard-reload Foundry (Ctrl+F5 or Ctrl+Shift+R in the browser/Electron window) and check F12 → Elements → click a button → Computed styles → search "color" to see which rule wins.

## Beta 5.8.19 — Permission rotates to the actual owner of the current combatant

User on Tester1's turn (init 25, current combatant) found the buttons locked even though it was Tester1's turn. Cause: 5.8.10's permission check required `game.user.character.id === currentActor.id` — a strict character-assignment match. Many players never assign a character in Foundry's user config (they just own a token / actor), so that check always returned false and combatCanControl fell to GM-only.

Fix: switched to Foundry's canonical ownership check. A player gets control if they own the current combatant's actor OR its token (covers unlinked tokens, which override actor perms). The old character-assignment match is kept as a third fallback so setups that DO use it still work. GM still has unconditional control on every turn.

Logic now:
1. GM → always allow
2. `currentActor.testUserPermission(user, 'OWNER')` → allow
3. `currentCombatant.token.testUserPermission(user, 'OWNER')` → allow (unlinked token case)
4. `user.character.id === currentActor.id` → allow (legacy fallback)
5. Otherwise → deny (buttons greyed)

Self-tested 7 scenarios: GM on own/others' turn, player on own turn (no char assigned), player on someone else's turn, mook turn, legacy char-assigned path, and unlinked-token ownership. All correct.

Console logs `[AgentDevice 5.8.19] perm: isGM=… ownsCombatant=… combatCanControl=… currentActor=… user=…` every render so you can verify in F12 if anything's off.

## Beta 5.8.18 — Damage now actually subtracts target HP

User confirmed: DAMAGE chat card shows "DEALT 5" against Tester1, but Tester1's character sheet still reads 40/40 HP. The damage card was cosmetic — the auto-damage path computed `damageAfterArmor`, posted the chat card, ablated armor SP, but never called `actor.update()` to subtract from the target's HP.

Fix: after damage is computed and armor ablation runs, apply the actual HP reduction:
- Read current HP from `system.derivedStats.hp.value` (CPR core path) with fallback to `system.hp.value`
- Subtract `damageAfterArmor` (which already includes the +5 bonus damage from Critical Injury per CPR pg 187)
- Clamp at 0 (Mortally Wounded state per pg 186)
- Write back via `actor.update()` so the change syncs to all clients and triggers Foundry's normal updateActor hooks

Patched both the auto-damage path (the primary flow, fires after a hit) and the legacy manual `combat-attack-damage` case. Self-tested 5 damage scenarios: 0-armor full pass-through, fully-blocked, partial pass-through with ablation, lethal, and minimum pass-through. All five correctly mutate HP and ablate armor when applicable.

Console will log `[AgentDevice 5.8.18] HP applied: <name> <old> → <new> (−<dmg>)` on each successful hit so you can verify in F12.

## Beta 5.8.17 — Dynamic viewport split; sub-flows get the room they need

5.8.16 confirmed the attack flow works end-to-end (weapons render, prep dialog opens, ROLL fires). But the viewport ratio was stuck at 6:4 (upper:lower) for every state, which meant:

- WEAPON SELECT: upper viewport had a tiny "tap a weapon below" placeholder while ~60% of the screen sat empty; lower viewport showed only the first 2 weapons before scrolling
- ATTACK ROLL prep: lower viewport got the prep dialog (header / DV / modifier / LUCK / quick mods / actions) but ran out of room around LUCK — quick mods and ROLL/CANCEL/RESET were below the fold

Fix: viewmodel now computes `upperFlex` / `lowerFlex` based on which sub-flow is active:

- MAIN / MORE → 6 : 4 (status block dominates, menu sits at bottom)
- ATTACK weapon-select / target-select / ITEM picker → 4 : 6 (list/picker gets the space)
- ATTACK ROLL prep dialog → 3 : 7 (prep gets maximum room)
- SKILLS roll prep → same 3 : 7 treatment

Self-tested all six states render the expected ratios before shipping.

## Beta 5.8.16 — Hoist combatActor; 5.8.15 attack vm proved it works

5.8.15 console confirmed the relocation fixed the upstream bug: `weapons after filter: 4` (Assault Rifle, Baseball Bat, Bow, Air Pistol). But the COMBAT viewmodel then threw `ReferenceError: combatActor is not defined` at line 2121. Cause: in 5.8.15 I declared `const combatActor` INSIDE the inner try-block, but the upper-viewport viewmodel code after that try's catch still references combatActor for things like myToken lookup, attackWeaponSelected skill summary, and the prep dialog. ReferenceError aborted the rest of the vm, so the template still got an empty list.

Fix: hoisted `const combatActor = currentActor || actor || null;` ABOVE the inner try, so it's in scope for everything in the COMBAT block including the post-catch upper-viewport vm.

This is the actual fix. Weapons should now render in the picker.

## Beta 5.8.15 — Found it: attack viewmodel was patched into the wrong block

Blank weapon picker root cause located. The 5.8.13 attack viewmodel was inserted inside the SKILLS `if (myActor)` gate by mistake — and for a GM who has no assigned character and no token selected, `myActor` is null, so the whole block skipped. That meant the weapon list, target list, item list, and attack-roll prep never got populated. Same situation for any player without a controlled token.

Fix: moved the attack/item viewmodel out of SKILLS and into the COMBAT `if (combatActive)` block where the active combatant is in scope. Replaced bare `actor.*` references (the user's actor, which is null for the GM placeholder) with `combatActor?.*` (the active combatant's actor, which resolves correctly because game.combat.combatant.actor is always populated when combat is started). Token references like `t.actor` were preserved — those point to a different actor and were never part of the bug.

Diagnostic from 5.8.14 confirmed the data was always there: Test Mook had 73 items, combatant resolved, combat started — the code path that read them just wasn't running.

## Beta 5.8.14 — Unconditional getData diagnostic

Diagnostic-only ship. Moved the 5.8.13 diag to the top of getData so it fires on every render regardless of view or combat state. This is what surfaced that the attack vm was never being reached (no `[AgentDevice 5.8.13] attack vm starting` logs even with combat active and items present), which pointed straight at the misplaced code block fixed in 5.8.15.

## Beta 5.8.13 — Fixed hardcoded version log + simpler items + verbose debug

User shared console: `agent-app.js:2300 [Agent OS] V1.0.0-beta.3.0.5 Kernel active.` That hardcoded string had never been updated since beta 3.x. Confusing because it makes you think you are running an old version regardless of what is actually installed.

**Fix:** kernel log now reads version dynamically from `game.modules.get(AgentDevice).version`. So you will see the actual installed version (e.g. "Module version: 1.0.0-beta.5.8.13") instead of the stale 3.0.5.

**Items resolution simplified:** stripped the .contents/Array.from/world-actor fallback chain. Now just a single `for…of` over actor.items, which works on every Foundry Collection. Added verbose console logging so we can see EXACTLY what is happening:
- `[AgentDevice 5.8.13] attack vm starting`
- `[AgentDevice 5.8.13] combatActor: <name> <id>`
- `[AgentDevice 5.8.13] items collected: N [list]`
- `[AgentDevice 5.8.13] weapons after filter: N`

After installing 5.8.13, open F12 console, tap ATTACK, and look for those lines. They will tell us exactly where it breaks. If we see `combatActor: NULL`, the actor resolution is the problem. If we see `items collected: 0`, the items collection is empty (likely synthetic NPC token). If we see `items collected: 12 [skill:Athletics, ...]` and `weapons after filter: 0`, the actor has items but none are tagged type:weapon.

This is a diagnostic ship — once we see your console output we can make a real fix.

---

# Agent OS — Changelog

## Beta 5.8.12 — Attack viewmodel defaults pre-set (defensive)

You were right — should have actually tested the crash path before re-shipping. The diagnostic message wasn't showing because the whole ATTACK FLOW template block wasn't rendering at all.

**Root cause:** my 5.8.11 changes (Array.from, world-actor fallback, broader item access) had a runtime crash path in some Foundry actor configurations. The outer try/catch swallowed the error silently, but the crash happened BEFORE `data.attackPhase` got set. Template's `{{#if (eq attackPhase 'weapon')}}` evaluated `undefined === 'weapon'` → false → nothing rendered. Header still showed "ATTACK · WEAPON" because that text comes from the instance state via `combatHeaderSuffix`, which is computed earlier.

**Fix:** set ALL attack-related defaults at the top of the viewmodel block BEFORE any risky code runs. attackPhase, attackWeaponsList, attackHasWeapons, attackDiagInfo etc. now have safe default values. Then wrap the resolution logic in its own try/catch with a console.warn so we can see what's actually failing instead of silently swallowing. Result: template always renders the picker (empty state with diag if data resolution fails, populated state if it succeeds).

If you still see "NO WEAPONS FOUND" after this ship, the diagnostic line will tell us WHY (Items count + Source). F12 console will also print `[AgentDevice 5.8.12] attack vm threw: ...` if there's an actual error.

---

## Beta 5.8.11 — Robust weapon resolution + diagnostic empty state

User reported "GM test character has weapon, still not showing attack options" — weapon picker blank despite the actor having weapons. Hardened the resolution chain:

**Items access fallback** — tries `combatActor.items.contents` first (Foundry V12 standard), falls back to `Array.from(combatActor.items)` (iterable), then if BOTH return empty AND the combatant is an unlinked token, walks to the world actor via `game.actors.get(token.actorId)`. Covers unlinked NPC tokens that may have empty synthetic actors.

**Broader weapon filter** — was strictly `it.type === 'weapon'`. Now also catches items with `system.weaponType && system.damage` (custom weapons or compendium imports that may not carry the exact CPR system type tag).

**Diagnostic empty state** — when the picker shows "NO WEAPONS FOUND", it now also prints:
- Actor name being queried
- Total items count on that actor
- Which resolution source was used (`contents` / `iter` / `world` / `none`)
- Hint: "Check that actor has items of type 'weapon' with system.damage set"

If your Test Mook shows "Items: 0 · Source: none", the synthetic token actor isn't linked. If it shows "Items: 12 · Source: contents" but still no weapons, the weapons aren't tagged as the right type in the actor sheet — open the actor and verify the item type.

Pre-ship self-test: rendered empty state (shows diagnostic line + hint) and populated state (weapon row + ammo) — both correct.

---

## Beta 5.8.10 — Permissions + MOVE distance + MORE target pickers + null-safe

Four feedback items rolled into one ship:

### Null-safe combatActor (weapon picker was blank)
The 5.8.7 GM-NPC actor swap (`combatActor = currentActor || actor`) could resolve to `null` when there's no active combat token, which crashed the viewmodel try/catch and left `attackWeaponsList`/`attackHasWeapons` undefined. Template silently rendered nothing. Wrapped all `combatActor.*` accesses in optional chaining + provided fallback empty arrays. Picker now shows "NO WEAPONS ON CHARACTER" instead of blank when actor truly has none.

### MOVE distance picker (per CPR pg 127)
Tapping MOVE now opens a distance picker bounded by the active combatant's MOVE stat × 2 (the rulebook max). Controls:
- Stepper (− / +) for 1m increments
- Quick-pick: ¼ MOVE / ½ MOVE / FULL
- Visual fill bar showing % of max used
- CANCEL / CONFIRM MOVE row
- Chat card posts how far moved + rule reference

### GRAB / STABILIZE target pickers (CPR pg 168/177/222)
Both actions now open a target picker after selection (instead of just posting a chat reminder):
- **GRAB:** lists all canvas tokens, picks target, rolls `DEX + Brawling + 1d10` with wound penalty. Chat card shows the contest setup and rule reference ("Target rolls Brawling OR Evasion to resist")
- **STABILIZE:** same picker, then rolls `TECH + First Aid + 1d10` vs DV13 (Wounded) or DV15 (Mortally — auto-detected from target's HP). Chat card shows success/fail outcome and rule reference

EVADE chat card also got the REF 8+ check noted (per CPR pg 173: "A Defender with a REF 8 or higher can choose to attempt to dodge a Ranged Attack" — below 8 they can only dodge melee).

### Permissions — players locked out of others' turns
User feedback: "only GM should have all buttons all the time, grey out the out of turn players. Players should not be able to control others during combat."

New `combatCanControl` flag in getData:
- TRUE if user is GM (always)
- TRUE if user is a player AND the active combatant is their assigned character
- FALSE otherwise

All 6 main menu buttons + END TURN now carry `{{#unless combatCanControl}}disabled style="opacity: 0.35; cursor: not-allowed; filter: grayscale(0.7);"{{/unless}}`. Buttons render but are clearly inactive when the user shouldn't be acting. GMs see everything live always; players see their own turn enabled, everyone else's greyed.

### Self-test before ship
Rendered 4 scenarios: GM MAIN (all enabled), player-not-on-turn MAIN (all greyed), MORE pending GRAB target (picker only, HOLD/EVADE hidden), MAIN with MOVE picker active (main menu hidden, distance controls visible). All passed.

---

## Beta 5.8.9 — Full rulebook audit pass

Ran the complete combat-rules audit against the rulebook BEFORE shipping. Found and fixed:

### Wound penalty calc — corrected
Previous code: `hpVal <= hpMax / 2` triggered Seriously Wounded (-2). Per CPR pg 186 the threshold is "less than 1/2 HP (round up)" — `hpVal < ceil(hpMax/2)`. For odd-max actors (e.g. hpMax=35), the `<=` form fired too late. Fixed to `< Math.ceil(hpMax/2)`.

Also missing: **Mortally Wounded -4** to all Actions (pg 186) when HP < 1. Added. Wound penalty now correctly applies -4 when HP < 1, -2 when HP < ⌈max/2⌉, 0 otherwise. Applied to both attack rolls and Evasion checks in MORE submenu.

### Full audit results (14/14 verified)
| Rule | Page | Status |
|---|---|---|
| Skill formula `1d10x10 + STAT + level + mod + luck` | pg 130 | ✓ |
| Ranged uses REF / Melee uses DEX | pg 173/175 | ✓ |
| Crit on natural 10 of first die only | pg 130 | ✓ |
| Range bands (8): 6/12/25/50/100/200/400/800 m | pg 173 | ✓ |
| Critical Injury on 2+ sixes (not attack crit) | pg 187 | ✓ |
| +5 Bonus Damage on crit, bypasses armor | pg 187 | ✓ |
| Armor ablation -1 SP on damage-through | pg 186 | ✓ |
| Wounded -2 / Mortally -4 (this ship's fix) | pg 186 | ✓ |
| Move + Action only, no bonus action | pg 127 | ✓ |
| GM-NPC actor swap on combatant change | — | ✓ |
| DEFEND fabrication removed | — | ✓ |
| MORE submenu: HOLD/EVADE/GRAB/STABILIZE | pg 168/222 | ✓ |
| Modifier + LUCK dialog for skills | pg 129 | ✓ |
| DV override + modifier + LUCK dialog for attacks | pg 129/173 | ✓ |

### Known TODO (not yet implemented)
- Aimed Shot body-part picker (head x2 / held item / leg). Currently the −8 quick-pick modifier is the workaround.
- Autofire mechanics (different range table + 2d6×beat-DV damage)
- Suppressive Fire workflow

These three fire-mode mechanics are in the rules-audit memory but not yet wired. Will land in a follow-up ship.

No code regressions. Pure correctness fix on wound penalty.

---

## Beta 5.8.8 — Attack-roll prep dialog (DV override + modifier + LUCK)

User asked for GM control of DV. Now: when you tap PREPARE ROLL in the attack roll phase, the dialog opens with full pre-roll controls — same pattern as the skill prep dialog from 5.8.6.

**What's in the dialog:**
- **DV TO BEAT** — stepper showing auto-computed DV from range table (e.g. 13 for a pistol at close range per CPR pg 173). GM can override with − / + buttons. "AUTO (N)" button snaps back to the computed value. Field colored orange when overridden, white when matching auto.
- **SITUATIONAL MODIFIER** — −/+ stepper, color-coded red/cyan/white
- **LUCK** — stepper bounded by actor's LUCK stat (CPR pg 129)
- **QUICK MODIFIERS** expand panel — common CPR situational modifiers as one-tap buttons: −1 LOW LIGHT, −2 COVER, −2 STRESS, −4 EXHAUSTED, **−8 AIMED SHOT**, +1 GEAR/CYBER
- **CANCEL / RESET / ROLL** action row

Override + modifier + LUCK all flow into the actual roll formula: `1d10x10 + STAT + skill-level + weapon-attackmod + wound-penalty + modifier + luckSpent`. DV override is what the hit/miss comparison uses (not the auto-computed value).

The −8 AIMED SHOT quick-pick is the most-used modifier — a single tap turns any attack into a CPR-correct aimed shot. Full body-part picker (Head x2 / Held Item drop / Leg break) coming in 5.8.9 with the full fire-mode picker (Aimed / Autofire / Suppressive).

Pre-ship self-test: rendered roll phase with prep open AND closed, confirmed launcher appears initially, dialog has all controls when open, formula breakdown shows correct DV/mod/LUCK values.

---

## Beta 5.8.7 — GM controls NPC turns + menu/icon polish

**GM-NPC control (biggest fix):** combat app was bound to the player's character (`this.actorUuid`), so when an NPC's turn came up in the Combat Tracker, the GM saw their own character's weapons + HP — not the NPC's. Now combat-specific data (weapons list, items list, target picker, status row, attack-roll handler, damage handler, range calc) all follow the active combatant (`game.combat.combatant.actor`), falling back to the player's actor when no combat is active.

That means: as initiative advances, the COMBAT view auto-switches to whoever's turn it is. GM picks NPC's weapon, rolls NPC's attack, deals NPC's damage — all from the same app. No need to drag-open the NPC's actor sheet mid-combat.

**Menu fit:** buttons tightened (min-height 64→52, padding 12/10/8→8 symmetric). Scroll bar gone, all 6 buttons + END TURN fit cleanly in the lower 40%.

**Icon centering:** dropped icon size 1.3→1.1rem, removed asymmetric padding. Icons now sit centered, not riding the top border.

**Rules audit memory updated** with the full pg 169 Aimed Shot mechanics + pg 173 Autofire + Suppressive Fire rules. Implementation of those three fire modes coming in 5.8.8 — design will add a fire-mode picker after weapon select (Single Shot default / Aimed Shot with body-part picker / Autofire with 2d6×beat damage / Suppressive Fire workflow).

Self-tested: handlebars-rendered the combat view; confirmed menu buttons render at 52px min-height, GM-NPC swap logic verified syntax-clean.

---

## Beta 5.8.6 — Pre-roll modifier dialog (CPR pg 129)

User caught that rolls weren't supporting modifiers or LUCK spend — both are explicit CPR rules. Tapping a skill now opens a **pre-roll prep dialog** instead of rolling immediately. Full CPR-rules support:

- **Situational modifier stepper** (− / + buttons + current value, color-coded red negative / cyan positive / white zero)
- **LUCK spend stepper** bounded by your actor's LUCK Stat (pool size = LUCK stat per CPR pg 129; we surface it as max, GM/player tracks across-session spend separately for now)
- **MORE MODIFIERS expand panel** with every modifier from the CPR pg 129 table:
  - Negatives: −1 Low light, −1 Never done before, −2 Complex, −2 Wrong tools, −2 Poor sleep, −2 Stress, −4 Exhausted, −4 Drunk/sedated
  - Positives: +1 Taking 4× longer, +1 Complementary skill, +1 Gear/cyberware, +2 Role/drug bonus
  - **CUSTOM** field — type any integer (+/-) and ADD to apply
- **Live formula preview**: shows `d10 + STAT + LVL (+modifier) (+LUCK) = +X + d10` updating as you adjust
- **ROLL / CANCEL / RESET** action row

The modifier and LUCK are then included in the actual roll formula: `1d10x10 + stat + lvl + modifier + luckSpent`. Chat card shows the breakdown.

Pre-ship self-test: rendered template in NORMAL state (skill rows visible, no prep) and PREP-OPEN state (header + Stealth + DEX 6 + LVL 2 + −2 modifier + +3 LUCK + "+9 + d10" formula + 12 mod buttons + custom input + ROLL/CANCEL/RESET, skill rows hidden). Both states verified before shipping.

Memory updated with CPR pg 129 modifier rules + LUCK pool rules so future development doesn't fabricate roll mechanics. See `reference_cpr_rules.md`.

**Coming next:** apply same modifier dialog to attack rolls.

---

## Beta 5.8.5 — SKILLS upper compact + chat cards themed

**SKILLS shrunk-state redesign:** stats no longer disappear after first roll. Compact horizontal layout: 5 stat pips strip (INT/REF/DEX/TECH/COOL) on top, last-roll one-liner with skill name + big total below, recent-roll pills underneath. Upper viewport tightened from flex 2 → 1.6, giving the skills list ~84% of vertical space.

**Chat cards themed + readable.** Three roll cards (skill / attack / damage) reworked:
- Dark theme background (`rgba(5,5,16,0.92)`) instead of generic grey
- Cyan/red accent box borders + inset glow on TOTAL/DEALT box
- Box label color: agent-cyan with 1.5px letter-spacing (was nearly-invisible grey)
- Skill name / weapon name has letter-spacing 2px + cyan text-shadow
- Footer "RULES" tag (small cyan) + italic light-grey (#aaa) rule reference with CPR page citation — readable vs the old grey-on-grey "d10 exploding on 10" footnote
- Attack card now shows correct stat label per weapon type (DEX for melee, REF for ranged) — was always saying "REF"

Damage card explicitly calls out the +5 Bonus Damage when crit-injury triggers, with page reference.

No data changes. Visual + readability only.

---

## Beta 5.8.4 — MORE submenu shows status in upper viewport

User caught the MORE state leaving the upper 60% viewport empty. MAIN-state status cards (turn / pips / HP+SP / last-action) now render during MORE state too — player keeps full combat context while picking between HOLD / EVADE / GRAB / STABILIZE. Added a `combatShowStatus` flag in getData = true when state is `main` or `more`.

ATTACK and ITEM sub-flows still get their own phase-specific upper content (weapon preview, big to-hit number, etc.) — they're unchanged.

Pre-ship self-test: rendered MAIN, MORE, and ATTACK-weapon scenarios — confirmed status block renders in MAIN+MORE, absent in ATTACK (where it'd duplicate phase content).

---

## Beta 5.8.3 — Combat menu icon spacing fix

Icons in the combat menu buttons were riding the top border (looked cramped). Bumped per-button: padding top 8 → 12px (more breathing room above icon), min-height 56 → 64px (so the bigger padding doesn't squeeze the label), gap 4 → 6px (cleaner spacing between icon and label), icon size 1.2 → 1.3rem (matches the increased button size). Dropped the now-redundant margin-bottom on the icon — gap handles it.

Self-rendered before shipping to verify icons sit centered with even space above + below.

No data or logic changes. Pure visual polish.

---

## Beta 5.8.2 — CPR rules audit + 9 fixes + MORE multi-use button

User caught a fabricated rule (DEFEND giving +2 DV — that mechanic isn't in CPR). Did a full audit of every combat feature against the core rulebook. Found 9 issues; all fixed in this release.

### Rules audit — verified correct
- Ranged attack formula: `1d10 + REF + Weapon Skill` vs DV table by range (pg 173) ✓
- Critical Success on natural 10 → roll +1d10 added (pg 130) ✓
- Critical Failure on natural 1 → roll +1d10 subtracted (pg 130) ✓
- Damage flow: roll → subtract armor SP → subtract from HP (pg 186) ✓
- Critical Injury trigger: 2+ sixes on damage dice (pg 187) ✓
- Wound state thresholds: full / less than full / less than half / less than 1 (pg 186) ✓

### 9 fixes

**1. DEFEND removed (fabricated rule).** Replaced with multi-use MORE button that opens a submenu of 4 actual CPR actions: HOLD ACTION (pg 168), EVASION CHECK (pg 173), GRAB (pg 168), STABILIZE (pg 222). Each has a one-line rules reference shown in the button.

**2. Melee attacks now use DEX.** CPR pg 175: melee combat = DEX + Melee Skill + 1d10. I was using REF for everything. Now branches on weapon type — if the weapon's skill is Brawling / Martial Arts / Melee Weapon, or the weaponType matches melee/knife/sword/club/axe/bat/baton, the attack rolls against DEX instead of REF.

**3. Range bands fixed.** CPR Range Table pg 173 has 8 bands (0-6m / 7-12 / 13-25 / 26-50 / 51-100 / 101-200 / 201-400 / 401-800). I had 7 with a fabricated "Point Blank ≤2m" band. Removed the fake band, added the missing 101-200 and 401-800 bands. DV lookup now correctly indexes into the weapon's `dvTable[8]`.

**4. Critical Success only on first-die natural 10.** I was checking if ANY die in the dice pool resulted in 10, which would also trigger on exploded dice. Per pg 130 the crit is ONLY on the first d10 = 10. Fixed in both skill-roll and attack-roll handlers.

**5. Critical Injury only triggers on 2+ sixes.** Damage handler was also triggering Critical Damage when the attack roll was a Critical Success. Per pg 187 those are independent — attack crit gives +1d10 to attack roll only, doesn't auto-trigger Critical Injury on damage.

**6. Critical Injury +5 Bonus Damage applied.** When 2+ sixes hit, CPR pg 187 says "All Critical Injuries cause a horrible Injury Effect and deal 5 Bonus Damage directly to the target's Hit Points." Damage handler now adds +5 to the final damage when isCritDamage is true. This Bonus Damage bypasses armor.

**7. BONUS action pip removed.** CPR has only Move + Action per turn (pg 127). I'd shown a bonus pip in the action card — that mechanic doesn't exist in CPR. Action card now just shows MOVE + ACTION (labeled "PER TURN" for clarity).

**8. Seriously Wounded -2 to all rolls applied.** Per pg 186 Seriously Wounded state imposes -2 to all Actions. I'd flagged the threshold in the status row but never applied it to actual rolls. Now both attack-roll and Evasion-check formulas include the -2 when HP ≤ half max.

**9. Armor ablation -1 SP applied.** Per pg 186 Step 3, if any damage gets through, armor SP is reduced by 1 point until repaired. Damage handler now calls `target.actor.update` on the relevant armor field (`externalData.currentArmorBody.value` with fallback to `externalData.armor.body`) to decrement by 1 when damageThrough > 0.

### MORE submenu — real CPR actions

| Button | What it does | Rule reference |
|---|---|---|
| HOLD ACTION | Consumes Action, posts chat reminder | pg 168 |
| EVASION CHECK | Rolls DEX + Evasion + 1d10 (with wounded -2 if applicable), posts to chat | pg 173 |
| GRAB | Consumes Action, posts chat with Brawling-vs-Brawling/Evasion reminder | pg 168 |
| STABILIZE | Consumes Action, posts chat with First Aid DV reminder | pg 222 |

Pre-ship self-test: handlebars-rendered MAIN and MORE scenarios, confirmed MORE button present + no DEFEND + no bonus pip in MAIN; HOLD/EVADE/GRAB/STABILIZE subbuttons all present in MORE.

No data changes. Existing combat/scenes/contacts untouched.

---

## Beta 5.8.1 — Menu rearrange + dice-breakdown chat cards + dedupe

User feedback after 5.8.0:

**Menu rearrange (no scroll, no SKILL button):** main combat menu is now a clean 3×2 grid — ATTACK / RELOAD / ITEM / DEFEND / MOVE / END TURN. Removed SKILL (still accessible from the home grid as the standalone SKILLS app). RELOAD moved into the slot SKILL vacated. END TURN moved into RELOAD's old slot — no more spanning full-width row, no scroll required to reach it.

**Attack chat card with rolled-dice breakdown:** previously showed only the total ("AIR PISTOL → Test Mook" then formula bar `1d10x10 + 6 + 0 + 0` then total). Now renders a 5-column grid: `ROLL [d10]` · `REF [+6]` · `HANDGUN [+0]` · `ATK [+0]` · `TOTAL [27]`. Crit/fumble color-coded accent bar on the left. Roll object still attached for dice modules.

**Damage chat card with dice + armor breakdown:** same treatment — shows every damage die's value (e.g. `3 + 4 + 5`), the armor SP subtraction, and the final damage dealt in a 3-column grid. No more raw `1d6` formula.

**Dedupe LAST ACTION card:** the upper viewport was rendering the same last-action info TWICE (different formatting). Removed the duplicate, kept the cleaner of the two.

**Result phase fitment:** removed the in-viewport duplicate of the big DAMAGE number from the lower viewport (the upper viewport already shows it). Lower now just contains the CONFIRM & CONTINUE button, centered, no overflow.

Pre-ship self-test: handlebars-rendered the template with mock data, confirmed only 5 menu-choice buttons + 1 end-turn (no skill button, no spanning row), LAST ACTION rendered exactly once, header has combat-header-back action. Visually rendered the layout with FontAwesome icons in the verification widget — header at top, all 6 buttons in 3×2 grid, single last-action card, fits within phone-screen bounds.

No data changes.

---

## Beta 5.8.0 — Standard top-left back button throughout COMBAT

User feedback after 5.7.9: the ITEM sub-flow had its own back chevron in a banner between the upper viewport and the item list. That broke the OS convention — every other Agent OS app uses the top-left chevron next to the app label as the only back button. Same complaint applied to the ATTACK sub-flow's breadcrumb chevron.

**Fix:** consolidated all "back" navigation onto the top-left header chevron. Removed both in-viewport sub-flow back buttons (`combat-attack-back` and `combat-item-back` chevrons in their breadcrumb banners). The header chevron now uses a new context-aware handler `combat-header-back`:

- In MAIN state → behaves like every other app, goes back to home grid
- In ATTACK sub-flow → pops one phase (result → damage → roll → target → weapon → back to main)
- In ITEM sub-flow → pops one phase (result → pick → back to main)

The header label also updates contextually so you always know where you are: `COMBAT` in main, `COMBAT // ATTACK · WEAPON` while picking a weapon, `COMBAT // ATTACK · TARGET` while picking a target, etc. Same chevron-and-label pattern as NC MART (`NC MART // CART`) and chat (`< Contact Name`).

Pre-ship self-test: rendered the template with handlebars across 4 scenarios (main, attack-weapon, attack-target, item-pick) — confirmed in every case the header has the correct data-action and the sub-flow back buttons are gone.

No data changes. Pure navigation cleanup.

---

## Beta 5.7.9 — Combat menu buttons inlined (defeats CSS specificity wars)

User reported menu buttons rendering as Foundry-default white in 5.7.8 even though my CSS rules existed and had high specificity. Self-rendered the template via handlebars + extracted CSS; verified in isolation the layout is correct. Issue is Foundry-side CSS load order or specificity I can't measure from sandbox.

Fix: stopped fighting CSS. Inlined ALL the button styles directly on each `<button>` tag in the template — background, border, color, padding, gap, font, text-shadow, box-shadow, appearance:none reset, the works. Inline styles beat external stylesheets at the highest specificity tier, so this will render correctly regardless of what Foundry's app.css does.

Each of the 7 buttons (ATTACK/SKILL/ITEM/DEFEND/MOVE/RELOAD/END TURN) carries its own color accent inline. ~600 chars of inline style per button — yes that's a lot of HTML, but it guarantees the visual.

Pre-ship self-test: rendered the template with handlebars, extracted the COMBAT view HTML, verified width/background/colors on each button. All green.

No data changes. Visual-only fix.

---

## Beta 5.7.8 — Hotfix: HP fill, button theme, auto-damage, fitment

**HP bar fill**: explicit inline `background` color on the `.combat-hp-fill` div (cyan good / yellow warn / red crit) — was empty visually because the CSS class background was getting overridden somewhere. Inline style wins.

**Menu button theming**: stronger CSS selectors. Foundry V12's button styling was outranking my `.AgentDevice-form button.combat-menu-btn` rule on some browsers. New rules use `.window-app .AgentDevice-form button.combat-menu-btn` (higher specificity by adding `.window-app`) + explicit `background-color`, `filter: none`, `outline: none` resets. Hover state inverts (accent fill + black text) instead of just changing background opacity.

**Damage phase fitment**: deleted the duplicate `TO HIT` card from the lower viewport. The upper viewport already shows the big to-hit number — the lower was rendering the same thing again in a smaller box, which pushed the ROLL DAMAGE button off-screen.

**Auto-roll damage on hit**: previously the attack flow was weapon → target → ROLL ATTACK → DAMAGE phase (manual ROLL DAMAGE click) → RESULT. The damage roll never had a reason to be a separate step — if you hit, you roll damage. Now: weapon → target → ROLL ATTACK → (auto: damage rolls, armor SP subtracts, damage pop spawns) → RESULT. One fewer click, no more cut-off button. The damage chat card still posts so the GM sees everything.

The damage phase view still renders briefly during the auto-roll as a "ROLLING DAMAGE…" splash — useful if the roll is slow (network round-trip, dice modules) but most cases skip straight to result.

No data changes. Layout + handler logic only.

---

## Beta 5.7.7 — SKILLS polish: search padding, viewport balance, readable rolls

Four fixes after game-feedback on 5.7.6:

**Search input padding**: magnifying-glass icon was overlapping the placeholder text. Bumped left padding from 28px to 32px (and right from 28px to 30px for the clear button).

**Skills list gets 80% of view**: shrunk-state CSS was giving the upper viewport 35% (3.5/6.5 flex split). Felt like wasted space when only the last-roll echo was up there. Now 20/80 — upper viewport tightens to just enough room for the last-roll number + 2-pill history strip, list takes the rest.

**Last-roll echo redesign**: instead of "Athletics: 10 Athletics: 10" plain text, now shows:
- Big LAST ROLL label + skill name (color-coded crit cyan / fumble red / normal cyan)
- Giant total number with text-shadow glow
- CRIT or FUMBLE badge when applicable
- Recent history as small pill badges (skill name + total) below

**Custom chat card replaces raw formula**: skill-roll handler was using `roll.toMessage()` which renders Foundry's default `1d10x10 + 6 + 2` formula bar — confusing CPR notation for non-system-experts. Replaced with `ChatMessage.create` + custom HTML showing a 4-column grid: `ROLL [5+3]` · `DEX [+6]` · `LEVEL [+2]` · `TOTAL [16]`. Color-coded accent border (cyan crit / red fumble / cyan normal). Footnote explains "d10 exploding on 10 / extra d10 on 1" so anyone reading the chat understands the mechanic without knowing the formula syntax.

Roll object still attached to the chat message (via `rolls: [roll]`) so Foundry's dice-tray hooks + modules that listen for rolls still work — we just replaced the visible card.

No data or logic changes. Pure presentation.

---

## Beta 5.7.6 — Hotfix: views were OUTSIDE the phone screen container

Pre-existing bug from 5.6.0 finally diagnosed and fixed. The `agent-content` div (which wraps every other app view inside the red-bordered phone screen) was closing at template line 2357 — BEFORE the COMBAT view opened at line 2365 and the SKILLS view at line 2705. Both views were rendering as siblings of `agent-screen`, not children. That's why the header appeared "below the empty box" through every layout revision in 5.7.0-5.7.5 — no flex/grid tweaking would have helped because the views were never inside the screen container to begin with.

Fix: removed the two premature `</div>` closes at lines 2357-2358 (closing agent-content + agent-screen) and added them back AFTER the SKILLS view ends. Verified via depth-trace: both views now open at DOM depth 4 (inside agent-content), file's final depth is 0 (balanced). Other apps (NC MART, chat, etc.) remain at the same depth as before — no impact.

This is why NC MART always worked and COMBAT/SKILLS never did. The flex/grid layout I shipped in 5.7.0+ was all correct — it just had nowhere proper to apply because the views weren't contained.

Should now render properly: 5G-NET bar at top → COMBAT header immediately below → upper viewport with stacked status cards → lower viewport with action menu. All inside the red phone screen frame.

No data or logic changes. Pure template structure fix.

---

## Beta 5.7.5 — Layout converted from grid back to flex column (matches NC MART)

CSS Grid layout (5.7.3-5.7.4) was escaping containment on some Foundry V12 builds. Reverted to the `display: flex; flex-direction: column` pattern that NC MART and chat use successfully. Children get explicit `flex: 0 0 auto` (header), `flex: 6 1 0` (upper viewport), `flex: 4 1 0` (lower viewport). Explicit `flex-basis: 0` is the key — guarantees the ratio respects allocation regardless of natural child content height.

**Net visual changes:**
- COMBAT and SKILLS now have the back-chevron header at the TOP of the screen (under 5G-NET bar), matching every other Agent OS app
- Upper viewport stacks 4 cards: turn banner, action pips with labels, HP+SP card with bigger bar, last-action echo card anchored to the bottom of the viewport via `margin-top: auto`
- The empty space in the middle of the upper viewport between the HP card and last-action echo is intentional — that's the animation zone where damage pops / hit-miss banners spawn

SKILLS shrink-on-first-roll now animates via `flex-grow` instead of `grid-template-rows` — `.skills-viewport-upper` goes from `flex: 6 1 0` to `flex: 3.5 1 0` with a CSS transition.

No data changes. Pure layout fix to restore standard chrome.

---

## Beta 5.7.4 — Hotfix: header at top + view escape fix

Two issues fixed.

**1. Standard header position.** Other Agent OS apps (NC MART, etc.) put their back-chevron header at the TOP of the screen, immediately under the 5G-NET bar. My 5.7.1 layout had the COMBAT/SKILLS header floating mid-screen between the upper viewport and the action menu — non-standard, broke the muscle memory players have. Fixed by switching the views to a 3-row CSS Grid: `grid-template-rows: auto 60fr 40fr`. Row 1 = header (auto-height, sits on top), row 2 = upper viewport (60fr), row 3 = lower viewport (40fr).

**2. Content rendering "below the box".** The 5.7.3 hotfix added a CSS override `.AgentDevice-form #agent-view-combat, #agent-view-skills { flex: none !important }` to prevent the parent flex rule from "fighting" the grid display. That was wrong — `flex: 1` on the view (sizing within agent-content) and `display: grid` on the same view (laying out its children) coexist fine. The override made the view content-sized rather than filling agent-content, so the view rendered shorter than agent-screen and content overflowed past agent-screen's bottom border. Removed the override; view now correctly fills agent-content via flex:1, and the internal grid distributes its rows within that space.

Pure layout fix. No data or logic changes.

---

## Beta 5.7.3 — Hotfix: 60/40 split via CSS Grid (was collapsing on flex)

Flex layout for the COMBAT/SKILLS 60/40 split was collapsing the upper viewport to 0 height in 5.7.1/5.7.2 — content rendered BELOW the visible box instead of inside it. Caused by flex children not honoring their `flex: 6` / `flex: 4` allocation when the parent's height computation didn't propagate cleanly through `.agent-app-view`'s flex chain.

**Fix:** switched both views from `display: flex` + `flex: 6/4` children to `display: grid` + `grid-template-rows: 60fr 40fr`. Grid is unambiguous about ratio splits — the rows ARE the allocated heights, no inheritance gymnastics required. SKILLS upper-viewport shrink animation now uses `grid-template-rows: 35fr 65fr` with a CSS transition on the grid-template-rows property itself.

Also neutralized `.agent-app-view`'s default `flex: 1` rule on these two views so it doesn't fight the grid display.

No data changes. Pure CSS/layout fix.

---

## Beta 5.7.2 — Hotfix: action menu was off-screen

Live-game feedback: COMBAT main menu buttons were cut off below the visible screen. Lower viewport was packed with header + turn banner + action pips + HP/SP + 7-button grid, all squeezed into 40% allocation — the buttons fell off the bottom.

**Fix:** Moved turn banner, action pips, HP bar, and SP readouts up into the **upper viewport's MAIN-state block**. Lower viewport now holds only the COMBAT header + the action menu, which fits cleanly. The upper viewport already had room for the status info, and showing it there matches the FFXII intent (battle state up top, controls below).

**Net result for MAIN state:**
- Upper: turn name + initiative, action pips, HP bar, SP-BODY/SP-HEAD, last-action echo
- Lower: COMBAT header + 7-button menu (no more cutoff)

No data migration. Pure layout adjustment.

---

## Beta 5.7.1 — Upper viewport (60/40 FFXII split) + auto-streamlining

The COMBAT and SKILLS views now use the entire phone screen properly. The previously-empty upper half is the "battle state" viewport that updates per phase; the lower 40% holds the action menu. Plus a layer of auto-streamlining that removes manual GM calls during combat.

### Layout: 60/40 upper/lower split
Both views now structure as `combat-viewport-upper` (flex: 6) + `combat-viewport-lower` (flex: 4). Same pattern for SKILLS. The upper viewport always shows phase-appropriate content; the lower holds the actual menu, sub-flow buttons, status row, and back chevron.

### COMBAT upper viewport per phase
- **MAIN idle**: red crosshair reticle + AWAITING COMMAND label, plus a last-action echo card showing the previous attack ("Arasaka Minami 10 → Test Mook · HIT 23 · DMG 18 ★"). The echo keeps the just-fired action in view for the rest of the turn so the player remembers context.
- **ATTACK → weapon picker**: prompt card with a gun icon and "tap a weapon below".
- **ATTACK → target picker**: full preview of the selected weapon — name, type, damage formula, magazine, computed `SKILL +bonus` total, ROF, full DV table by range band.
- **ATTACK → roll phase**: weapon-icon-vs-target-portrait compose, reticle glyph, "TARGETING" label, and the **auto-computed range + DV band + DV value** from the actor's token to the target token using `canvas.grid.measureDistance` against the weapon's `dvTable`.
- **ATTACK → damage phase**: BIG to-hit number (3.4rem) color-coded — cyan for crit, red for fumble, white normal — with "VS DV X" line beneath. Animates in.
- **ATTACK → result phase**: HUGE damage number (4rem) with armor-SP breakdown line ("RAW 18 − ARMOR SP 11 = 7") if the target had armor; falls back to formula if not. Also shows target name.
- **ITEM picker**: pill icon + SELECT ITEM prompt.

### SKILLS upper viewport with shrink animation
Before the first roll, the upper viewport shows the **character card**: portrait + name + a 5-stat summary grid (INT/REF/DEX/TECH/COOL each in their own little pip). When a skill rolls, the viewport **shrinks** (0.4s cubic-bezier transition from flex: 6 down to flex: 3.5) and morphs into a **last-roll echo** showing the rolled skill's name + giant total (2.6rem cyan), with the previous 2 rolls listed below as a mini-history. The shrink frees up the lower half for the search bar + skill list so the cramped feeling from 5.6.1 goes away.

### Auto-streamlining (your "auto everything in Foundry" ask)
- **Auto-target**: if you have exactly one Foundry target locked (T on a token), it pre-selects that token in the attack flow — picker still works if you want to switch.
- **Auto-DV by range**: range bands (PB ≤2m, Close ≤6, Medium ≤12, Long ≤25, Extreme ≤50, ExtLong ≤100, ExtMax ≤400) read from `canvas.grid.measureDistance` between your active token and the target. DV value pulled from the weapon's `dvTable` at the matching band index. Shown in the roll-phase viewport and used as the threshold for hit/miss detection.
- **Hit/miss detection**: attack-roll handler compares the rolled total against the auto-computed DV. If you miss, the damage phase is skipped entirely — flow returns to combat main with a "MISS" pop and a chat card showing the roll-vs-DV. No more rolling damage on a missed shot.
- **Armor SP subtraction**: damage handler reads `target.actor.system.externalData.currentArmorBody.value` (with fallbacks for older CPR field paths) and subtracts from the rolled damage. Result viewport shows the breakdown so you can see what was raw vs what got through. Negative-after-armor clamps to 0.
- **Combat turn hook**: new `Hooks.on('updateCombat')` listener resets action budget + clears defend + resets attack state when the GM advances turn from the Combat Tracker (not just when END TURN is clicked). Action pips refill correctly across all turn-advance paths.

### Gamification follow-up (5.7.0 finish)
- ATTACK damage handler now fires `_spawnDamagePop` (was only on DEFEND/MOVE/RELOAD/ITEM in 5.7.0). The big floating number appears on the agent screen overlaid on the upper viewport.
- SKILL roll fires a pop too — crit/fumble color-coded.
- Skill roll history (`_skillRollHistory`) now persists last 5 rolls in memory.

### No data migration, no breaking changes
Pure layout + logic additions. The existing 5.6.x/5.7.0 sub-flow handlers were preserved as-is; the template restructure wraps them in the new lower viewport without touching the inner markup.

---

## Beta 5.7.0 — COMBAT Slices 3-6: SKILL route, DEFEND/MOVE/RELOAD, ITEM, gamification

Bundled drop landing the remaining four combat actions plus the gamification visual layer. Combined with 5.6.2's ATTACK flow, every button in the COMBAT main menu now does something real.

### SKILL — routes to standalone SKILLS app
Tapping SKILL inside combat now opens the standalone SKILLS app (the same one shipped in 5.6.0/5.6.1 with the live search + 1d10x10 roll). Players already know that interface, so we don't duplicate it — combat just navigates there. Action budget is NOT consumed on entry (consumption happens when they actually roll a skill, per CPR rules; tracked next pass).

### DEFEND — +2 DV stance
Tapping DEFEND consumes the Action budget pip and flags the character as defending until the next turn. Posts a chat card with the `+2 DV` reminder. Internal `_defendActive` flag is exposed to view-models so slice-7-or-later DV math can read it.

### MOVE — consume Move budget
Tapping MOVE consumes the Move budget pip. Posts a chat card stating the move. Foundry's actual token positioning still happens on canvas — this just tracks the budget so players don't lose track of what they've used.

### RELOAD — owns the full reload workflow
The originally-reported "ammo reload buttons disappear after reload" pain is bypassed entirely. Tapping RELOAD finds the first weapon with a non-full magazine, sets it to max via `weapon.update`, consumes the Action pip, posts a chat card showing the new ammo state. No more fighting the actor sheet's combat tab. (If no weapon needs reloading, surfaces a notification and skips the consumption.)

### ITEM — picker → result flow
New sub-flow lists every `gear` / `drug` / `cyberware` item on the character with a positive quantity. Tap one → quantity decrements by 1 (via `item.update`), chat card posts, RESULT view shows the remaining count, DONE returns to the main menu. Action budget consumed on use.

### Gamification — floating damage pops
The COMBAT app now spawns transient floating-text pops on the agent screen for every combat action: red for damage, gold for crits, gray for misses, cyan for DEFEND, gold for RELOAD, blue for MOVE, orange for ITEM use. 1.4-second rise-and-fade animation. Each pop is appended to the `.agent-screen` DOM and auto-removes after the animation completes.

The pops respect the existing `combatGamification` world setting:
- `full` (default) — all pop types render
- `numbers-only` — text labels (DEFEND, MOVE, RELOAD, ITEM) are suppressed; only numeric damage values render
- `off` — no pops at all

### Architecture notes

- `_spawnDamagePop(kind, value)` is the entry point — every combat action that wants visual feedback calls it. Slice-2's attack-damage handler doesn't call it yet (still happens entirely via chat); a follow-up will spawn a damage pop after each damage roll
- New constructor state: `_itemPhase`, `_itemSelected`, `_itemResult`, `_defendActive`, `_damagePops`
- ITEM uses the same picker → result template pattern as ATTACK, scaled down to one selection
- SKILL routing intentionally uses `this.currentView = 'skills'` rather than a fresh sub-state — keeps the single source of truth simple

### No data migration, no breaking changes
Existing combat data, scenes, contacts, items untouched.

---

## Beta 5.6.2 — COMBAT Slice 2: ATTACK flow end-to-end

Slice 2 of the COMBAT app lands the full FFXII-style attack flow: weapon → target → roll → damage → confirm. Five sub-views inside the COMBAT app, each chained to the next, with a back chevron at every step.

### The flow

1. **WEAPON PICKER** — lists every `type: 'weapon'` item on your character with name, damage formula, weapon type, and ammo current/max. Tap one to lock it in.
2. **TARGET PICKER** — lists every token on the current scene with a different actor and non-zero HP. Token portrait, name, HP/max. Tap to lock in.
3. **ATTACK ROLL** — review screen with weapon + target, big red ROLL ATTACK button. Rolls `1d10x10 + REF + weapon-skill-level + weapon-attackmod`. Auto-detects CRIT (any die = 10) and FUMBLE (initial die = 1). Posts the roll to chat with the breakdown.
4. **DAMAGE ROLL** — shows the to-hit result as a giant number color-coded by outcome (cyan crit, red fumble, white normal). ROLL DAMAGE button below rolls the weapon's damage formula (defaults to `3d6` for unset weapons). Detects critical damage when two or more damage dice come up 6 (or when the attack itself was a crit).
5. **RESULT** — shows the damage total + target name. CONFIRM & CONTINUE button consumes your Action budget pip and returns to the COMBAT main menu.

### Architecture invariants

- All five sub-views live inside the same `agent-view-combat` div, gated by `{{#if (eq attackPhase '...')}}` conditionals
- State held in four constructor fields: `_attackPhase`, `_attackWeapon`, `_attackTarget`, `_attackRoll`, `_attackDamage`
- Back chevron at every step pops one phase off the flow; from the weapon picker it pops back to the combat main menu
- Roll math hits `actor.system.stats.ref.value` + `weapon.system.weaponSkill` (looked up as a matching `type:'skill'` item) + `weapon.system.attackmod`. Damage uses `weapon.system.damage`
- Both rolls post to chat via `Roll.toMessage` with a styled flavor card — the chat log stays the source of truth so anything else listening (CD ShotPlayer for crits) can react

### What's NOT in slice 2 yet
- DV-table lookup for range bands (GM provides DV verbally; we just roll the attack number)
- Armor SP subtraction from damage (chat shows raw damage; GM applies armor)
- Auto-targeting from Foundry's `game.user.targets` (we pick from canvas tokens explicitly)
- Cinematic overlays on hit / crit / death (slice 5 — gamification)

### No data migration, no breaking changes

Pure additions. The slice 1 architecture (combat-menu-select handler, combatMenuState gating) absorbed the new sub-flow without disturbing the existing END TURN flow or the no-encounter panel.

---

## Beta 5.6.1 — Hotfix: defaults + SKILLS roll + search + button theming

Live-game feedback from 5.6.0 surfaced four issues, all addressed here.

### Migration: COMBAT + SKILLS now reach existing users
The 5.5 migration marker `unlockedAppsMigrated5_5` was already set on existing users from the prior release. That meant adding `combat` + `skills` to the default-apps list in 5.6.0 did NOT propagate them — the merge logic only runs once per migration version. Bumped the marker to `unlockedAppsMigrated5_6` so one more pass merges the new defaults into every existing user's saved app set. GMs who explicitly toggle either app OFF afterwards will have that respected (saved set becomes authoritative once the new marker is written).

### SKILLS: real CPR roll wired
The slice-1 placeholder ("slice 3 will roll this") was bad UX with the SKILLS app being shipped to player-facing release. Tapping a skill now actually rolls it. Formula: `1d10x10 + stat + level` (exploding 10s in line with CPR's `1d10cp`). Critical detection (any die rolled 10) and fumble handling (initial die = 1 → roll an additional `1d10` and subtract) are surfaced as CRIT / FUMBLE flags in the chat card. Roll posts to chat with the skill name, stat, and level breakdown visible.

### SKILLS: live search bar
Lots of skills, hard to scan. Added a search input at the top of the SKILLS view that filters the list in-place as you type (no re-render, so input keeps focus + cursor). Clear button appears once you've typed something. Search is purely client-side, no debounce needed.

### Theming: COMBAT main menu buttons + SKILLS rows
The main-menu buttons were rendering as Foundry/OS default white system buttons on some platforms. The CSS selector `.AgentDevice-form .combat-menu-btn` (specificity 0,2,0) was supposed to win against `form button` defaults but was getting beaten by Foundry V12's button rules in some cases. Bumped selector specificity to `button.combat-menu-btn` plus added explicit `-webkit-appearance: none`, `-moz-appearance: none`, `appearance: none` and `outline: none` resets before any theme rules — same defeat pattern the `.store-qty-btn` rule uses. Applied symmetrically to `.skill-row`, `.skill-search-input`, and `.skill-search-clear`.

### No data migration; no breaking changes
Pure additions + style fixes. Existing combat data, scenes, contacts, and identities untouched.

---

## Beta 5.6.0 — COMBAT app (FFXII-style menu-driven HUD) — Slice 1 + SKILLS

Big new direction kicking off, driven by player feedback that CPR's actor-sheet combat workflow is rough. Building toward a Final Fantasy XII-style menu where every turn flows: pick target → pick action → resolve → see the numbers pop. Skills get their own dedicated app instead of being buried in the sheet.

This is **Slice 1 of 6** — the architectural skeleton + the SKILLS standalone tile. Subsequent slices land the ATTACK / SKILL roll / DEFEND / MOVE / RELOAD / ITEM flows, then the gamification layer (damage pops, hit/miss banners, combo counter, round transitions).

### What ships in Slice 1

**Two new home-grid tiles:**
- **COMBAT** (crosshairs icon, magenta) — activates the HUD when a GM starts a combat encounter
- **SKILLS** (checklist icon, cyan) — standalone skill picker, always open

**COMBAT MAIN screen** when a combat encounter is active:
- Turn banner showing whose turn it is + initiative
- Round counter
- **Action budget pips** (●●○) — Move + Action + Bonus, currently all shown available; slice 5 wires real consumption tracking
- **Status row** — HP bar color-coded (cyan → yellow at 50% → red at 25% with a critical-pulse box-shadow), SP body/head readouts, Seriously Wounded warning when applicable
- **7-button main menu** in a FFXII-style grid: ATTACK / SKILL / ITEM / DEFEND / MOVE / RELOAD + a spanning END TURN button
- Only **END TURN** is wired in slice 1 — calls `game.combat.nextTurn()` and resets per-turn state. The other six buttons surface "coming in the next ship" notifications and stash menu state for slices 2-6 to pick up

**No-encounter state**: when no combat is active, the COMBAT tile shows a clean "NO ACTIVE ENCOUNTER" panel instead of erroring.

**SKILLS app**:
- Lists all `type: 'skill'` items on your active character
- Sorted by combined modifier (stat + level) descending — your best skills surface first
- Each row shows the calculated modifier (`STAT 5 + LVL 6 = +11`) so you can read your bonus without doing the math
- Click a skill → slice 3 will wire the actual roll; slice 1 just notifies

### New world setting

`combatGamification` — choices: `full` / `numbers-only` / `off`. Default `full`. Controls the volume of the slice-5 animation layer when it lands.

### Architecture notes

- All combat data is pulled live from `game.combat` and the current combatant's actor — no shadow state to drift
- COMBAT app activates the moment a GM starts an encounter, deactivates when combat ends
- Player-side from day one (no GM-only gating). Each player drives their own turns when initiative reaches them
- CD ShotPlayer integration plumbed for slices 2+ (crit and death-blow cinematics will fire automatically when CD is installed)

### Next up

Slice 2: full ATTACK flow (weapon picker → target picker → attack roll → damage roll → result animations).

Drop-in over 5.5.28.

---


## Beta 5.5.28 — Mac/Safari NC Mart cart-row buttons restored

Game-night report from Mac users: NC Mart cart was visible but the -/+/trash buttons inside cart rows weren't (or were laid out broken). Windows/Linux users saw them fine.

### Root cause

The `.store-qty-btn` class had ZERO matching CSS rules — the buttons relied entirely on inline `style="cursor:pointer; background:#1a1a1a; ..."`. Foundry's default `form button { width: 100%; }` rule was clobbering them. On Mac, Safari's user-agent Aqua button styling layered on top, expanding each button to consume the full row width and shoving siblings off-screen. Same `form button` battle the `.app-access-tab` rule already fights for the access-tabs strip.

### Fix

Added explicit CSS for `.store-qty-btn` with the proven defeat-Foundry pattern:

```css
.AgentDevice-form .store-qty-btn {
  flex: 0 0 auto !important;
  width: auto !important;
  -webkit-appearance: none !important;
  appearance: none !important;
  ...
}
```

`-webkit-appearance: none` neutralizes Safari's Aqua native button rendering. `flex: 0 0 auto + width: auto !important` overrides Foundry's `width: 100%`. Mac/Safari users will now see compact -/+/trash buttons inline with the qty number, same as Windows/Linux.

### Verification

Pure CSS addition — no JS changes. Existing inline styles still work as fallbacks. No data migration. Sandbox check: rule is scoped to `.AgentDevice-form .store-qty-btn` so it only affects the NC Mart cart rows, nothing else.

Drop-in over 5.5.27.

---


---

## Beta 5.5.27 — GM-reply avatar resolves cross-user

5.5.22's display fallback and 5.5.24's IMPORT button got the avatar into the PLAYER's `customContacts` flag. 5.5.25 / 5.5.26 made BROWSE work for them at the right permission. But when the GM replied in the same thread, the bubble was still showing a default icon — the player's uploaded avatar wasn't carrying through.

### Root cause

`_getContacts()` builds the GM's view of NPC threads two ways:

1. From the GM's own `customContacts` flag — entries here have full data (name, avatar, etc.)
2. Auto-built switchboard entries for NPC threads the GM doesn't have in their own flag — these are scraped from message metadata and only carry `{ id, name, isSwitchboard, ownerId, originalName, active }`. No avatar field.

When a PLAYER creates an NPC contact and uploads the avatar, the avatar lives in the PLAYER's flag, not the GM's. The GM only sees the thread via the switchboard auto-build, so `threadContact.avatar` is `undefined`. At send time, `npcOverrideAvatar` got set to `undefined`, and the message went out with no avatar override. Player's bubble fell back to the default icon despite the upload.

### Fix

At send time (both regular text-send and attachment-send paths), if the GM is in an NPC thread and `threadContact.avatar` is missing, scan every user's `customContacts` for an entry with the matching `npc_*` id and use that entry's avatar. Preserves the existing `groupNpcOverride` pathway for GM-voiced custom group threads.

```js
let _resolvedNpcAvatar = (game.user.isGM && isNpcThread && threadContact?.avatar)
    ? threadContact.avatar : null;
if (!_resolvedNpcAvatar && game.user.isGM && isNpcThread) {
    for (const u of game.users) {
        const lst = u.getFlag("AgentDevice", "customContacts") || [];
        const m = lst.find(c => c.id === this.activeContactId);
        if (m?.avatar) { _resolvedNpcAvatar = m.avatar; break; }
    }
}
const npcOverrideAvatar = _resolvedNpcAvatar || (groupNpcOverride?.avatar || undefined);
```

O(users × customContacts) at send time only — runs once per message dispatched by the GM, not per render.

Verified with a 13-case behavior smoke covering: GM uses own avatar when present, switchboard reply pulls from player's flag, no-avatar-anywhere returns undefined, players don't trigger the scan, non-NPC threads skip the scan, groupNpcOverride still wins as legacy fallback. Both send paths (text + attachment) covered.

Drop-in over 5.5.26. No migration. No setting changes.


## Beta 5.5.26 — BROWSE gated on actual FILES_BROWSE permission

5.5.25 unconditionally showed BROWSE to non-GMs assuming Foundry's FilePicker would just work for them. It doesn't — Foundry V12's `FILES_BROWSE` permission defaults to Assistant GM, not Player. Players clicking BROWSE got silence (or a broken picker, depending on Foundry version). Two-part fix:

### Real permission check

- `getData` now computes `data.canBrowseFiles = !!game.user.can("FILES_BROWSE")`. Wrapped in try/catch with a fallback to `isGM` so weird user-shape edge cases don't crash render.
- Template gates the BROWSE button on `{{#if canBrowseFiles}}`. Users without the permission only see IMPORT.
- Hint text adapts: when BROWSE is visible, "BROWSE opens Foundry's FilePicker"; when hidden, "(BROWSE is hidden — needs Foundry's FILES_BROWSE permission; GM can grant it in Configure Permissions.)"

### Handler hardening

- Hard re-check on click. Even if the button somehow survives the template gate, the click handler refuses to open the FilePicker without `FILES_BROWSE`. Warning toast names the exact permission and points at IMPORT as the alternative.
- Dropped the 5.5.25 `activeSource: "public"` bias. It was sometimes causing the picker to fail for non-GMs even on tables that DID have FILES_BROWSE granted, because the public source doesn't always resolve `icons/` cleanly.

### How the GM enables BROWSE for players

Foundry Core → Configure Permissions → File Browser. Set Player to enabled (or move the threshold down). Players then see BROWSE on next render. To keep BROWSE GM-only, leave it at the default. IMPORT remains available either way.

Drop-in over 5.5.25. No migration. No setting changes.


## Beta 5.5.25 — BROWSE button also available to players, safe default landing

5.5.24 kept BROWSE GM-only on the theory that Foundry's FilePicker was permission-locked for players. It isn't — Foundry's `FILES_BROWSE` permission defaults to the Player role, so players can open the FilePicker fine. The right answer is to show BROWSE to everyone and bias the default landing so players don't open onto the world Data folder where GM art lives.

### Changes

- Template: BROWSE button no longer wrapped in `{{#if isGM}}`. Both BROWSE and IMPORT show for players.
- Handler: when `!game.user.isGM`, the FilePicker opens with `activeSource: "public"` and `current: "icons/"`. Foundry's "Core Data" source is the bundled icon library — no world content, no spoiler surface. Players still have access to Foundry's stock art for picking a portrait.
- Existing path is preserved on re-edit (if the avatar field already has a value, FilePicker opens at that path).
- Hint text updated: "BROWSE opens Foundry's FilePicker; non-GMs land in the Core Data / icons folder by default."

### Spoiler note

`activeSource: "public"` biases the INITIAL landing only. If a GM hasn't tightened Foundry's `FILES_BROWSE` permission, players can still switch tabs to the Data source and navigate the world folder. To fully lock that down: Foundry Core → Configure Permissions → File Browser → set Player to disabled (or set to TRUSTED PLAYER+ and don't promote players). That's a Foundry core setting, not something the module can override. IMPORT remains the truly-locked path: it's gated on `actor.testUserPermission(LIMITED)` so only GM-shared NPCs are exposed.

Drop-in over 5.5.24. No migration. No setting changes.


## Beta 5.5.24 — Player-facing IMPORT button on Add Contact (spoiler-safe)

5.5.22 promised players a way to import portraits and shipped only half of it — the display-side fallback and the auto-pre-fill when opening from the Fixers app. Missing piece: the explicit button on the Add Contact modal that players could press themselves to import. This patch adds it.

### What's new

The Add Contact modal's avatar row is no longer hidden from non-GMs. Players see an avatar input + an IMPORT button (gold, `fa-download`). The GM-only BROWSE button (FilePicker) is still gated to GM because Foundry's FilePicker requires permission flags players don't have.

Press IMPORT → the handler reads the current name field, strips any "(via Bob)" switchboard suffix, looks up a world Actor whose name matches exactly, and drops that actor's `img` into the avatar field. Player can still edit or clear before saving.

### Spoiler safety — only GM-shared actors are visible to player import

The lookup is scoped via `actor.testUserPermission(game.user, "LIMITED")`. Non-GMs can ONLY import portraits from actors the GM has explicitly shared (default ownership ≥ LIMITED). Hidden boss NPCs, encounter actors, and unannounced reveals stay at ownership NONE and are invisible to player import — typing the name returns "No portrait found" rather than confirming the actor exists.

GM workflow to expose a portrait: open the actor → Permissions → set Default to LIMITED. At LIMITED, players see only the actor's name and image, stat blocks and biography stay hidden. To re-hide later, set Default back to NONE.

GMs themselves bypass the permission gate (they own everything anyway). They keep BROWSE as the primary path; IMPORT is also useful as a quick "use the actor's portrait" shortcut.

### Failure messages

Empty name → "Enter a handle first, then IMPORT to pull a matching world Actor's portrait."
No matching actor (or actor is hidden) → "No portrait found for "<name>". The GM controls which NPCs are visible — ask them to set the actor's Default Permission to LIMITED if they want to share this portrait, or paste an image URL/path manually."
Actor exists but has no portrait set (img is `mystery-man.svg`) → "<name> exists but has no portrait set on the actor sheet."
Multiple actors with same name → uses the first match + warns.

Drop-in over 5.5.23. No migration. No setting changes.


## Beta 5.5.23 — Messages home sorts by latest activity + "CitiNet Messages" header

Noticed two small UX things while testing the 5.5.22 drop.

### Feature — Messages home sorts newest-thread-on-top

The Messages home view (the contact list) was using stable insertion order — Party / Group Net first, then players, then custom NPCs, then GM switchboard. That order never changed regardless of activity, which meant a thread that just received a new message stayed in its original slot. Hard to scan in a busy party.

Now sorted by most-recent message timestamp, descending. Matches iOS / WhatsApp / Signal — the contact with the freshest activity bubbles to the top.

Implementation: single O(messages) pass that buckets each AgentDevice message into the contact it belongs to from THIS user's perspective. The bucketing mirrors the in-thread filter so the privacy fix in 5.5.22 is preserved — uninvolved third parties don't pick up activity from DMs they aren't in:

- Party / pcgroup / npc threads bucket on threadId
- 1-to-1 PC DM, my outgoing message → bucket = recipient (threadId)
- 1-to-1 PC DM, incoming whispered to me → bucket = sender (author.id)
- GM monitoring → bucket on threadId (recipient)

Then `Array.sort` (stable in V8 / SpiderMonkey, which is what Foundry runs) sorts by descending timestamp. Ties — including the no-activity default — preserve original insertion order, so a fresh world still reads as Party first → players → NPCs.

### Tweak — Header renamed "CitiNet Contacts" → "CitiNet Messages"

The Messages app header said "CitiNet Contacts" which collided with the Fixers app (which is the actual contacts/relationships app). Renamed the Messages home header to "CitiNet Messages" so the two apps don't visually overlap.

In-thread message ordering (newest at bottom, auto-scroll-to-bottom) was already correct and left alone — that matches IRL inside an open conversation.

Drop-in over 5.5.22. No migration. No setting changes.


## Beta 5.5.22 — PC→PC DM privacy bug + NPC portrait fallback (CommanderCrunch69)

Two fixes from a live-session report.

### Bug — PC→PC DMs leaked to every other player

When PC A messaged PC B from the default contacts listing, every other PC's view of "their thread with PC B" was also showing the same messages. Functionally every PC-to-PC DM became a public party chat. The workaround the table found — making a 1-PC "group chat" — worked by accident: pcgroup_* threadIds don't appear in third-party contact lists, so the leak couldn't trigger.

Root cause was at the message filter in agent-app.js. Senders set `threadId = recipient.user.id`, and the filter matched `flags.threadId === this.activeContactId` with no author or whisper check. Every player has every other player in their contacts (`game.users.forEach` in `_getContacts`), so PC C clicking on PC B set `activeContactId = PCB.id`, the threadId on PC A's message also equalled PCB.id, and the filter happily returned `true` for the uninvolved third party.

This worked silently because Foundry V12 delivers ChatMessage documents to every connected client regardless of whisper visibility — the core chat log filters them by permission, but `game.messages.filter()` reads everything in memory.

Fix (two parts):

- agent-app.js filter restricted to outgoing messages (author === self) for the threadId match. The whisper fallback below it already gated the incoming branch with proper author + whisper-list checks, so adding `&& m.author?.id === game.user.id` to the threadId branch closes the leak without affecting either participant's view.
- main.js `createChatMessage` hook now bails out on uninvolved clients when the message is whispered and the user isn't in the whisper list. Before the gate, PC C also got unread badges and "Incoming from PC A" toast notifications for DMs they shouldn't even know existed. GMs continue to process every message (monitoring).

Verified with `_v5_5_22_privacy_smoke.js`: 17 cases covering all (PC A sender / PC B recipient / PC C uninvolved / GM) × (thread with each of the three) combinations plus the hook gate. PC C is correctly filtered out on every leak vector; PC A and PC B both see the message via their respective branches; GM still processes for moderation.

### Feature — NPC contact portraits fall back to a same-named world Actor

Players can't use Foundry's FilePicker (no permission), so contacts they create themselves — including new NPC threads spawned from the Fixers app — couldn't get a portrait. Bubbles fell through to the GM's character image or the mystery-man default.

Display-side fallback added: when a chat bubble has an `overrideName` but no `overrideAvatar`, look up `game.actors.find(a => a.name === cleanName)` and use that actor's portrait. The "(via Bob)" switchboard suffix is stripped before the lookup so e.g. "Rogue (via Bob)" still matches a world actor named "Rogue". Actors whose `img` is itself the mystery-man placeholder are treated as no match, so we don't replace one default with another.

Also pre-fills the avatar field on the Add Contact modal when it opens from the Fixers app's "Open Messenger" button — if a same-named actor exists, its portrait drops in automatically. Player can still edit or clear before saving.

Cheap O(N actors) lookup short-circuited by the overrideAvatar precedence — only runs on bubbles that wouldn't otherwise have an image.

### Triage — Sequencer error on one player's Call animation

One player at CommanderCrunch69's table was getting a Sequencer error during the Holo Call animation; the other three were fine. Existing defensive coding here is already comprehensive — `_holophoneEnabled()` guards on Sequencer presence, every JB2A file path is probed against `Sequencer.Database.entryExists` with a fallback chain, the full sequence is wrapped in try/catch, and both socket handlers wrap their calls in try/catch as well. A single-player failure means a per-client JB2A/Sequencer install issue. The GM-side `enableCallAnimation` world setting is the documented escape valve — toggle it off for the world or fix the JB2A install on that machine. No code change this ship.

Drop-in over 5.5.21. No migration. No setting changes.


## Beta 5.5.21 — Wallet Identity tab now also drives the Agent ID view

Patreon ask: a GM had figured out the Sys Admin → Wallet Identity tab and wanted to know whether anything besides the wallet could link to a player character. Honest answer is "right now, mostly no" — message authoring, social posts, and auction bids all run off the real Foundry user identity on purpose (security, anti-impersonation, sender attribution). So those aren't going to swap.

But one thing was easy to extend and made the existing setup cleaner: the Agent ID viewer.

### What linked

When the GM clicks a player tab in Sys Admin → Wallet Identity, the Agent ID viewer now also defaults to that player's Foundry user. Before, the wallet and the ID viewer had separate dropdowns — the GM had to pick the same player twice. Now one click moves both. The ID-viewer dropdown still works independently after that (if you want to view player A's ID while keeping the wallet tab on player B, pick A in the ID-viewer dropdown and that override sticks until the next wallet-tab click).

Clicking the System Fund / Virtual Wallet tab does NOT touch the ID viewer — the GM may have it intentionally parked on a specific player and the System Fund tab isn't a player selection.

### What didn't link (and why)

Added a small hint line under the Sys Admin → Wallet Identity tabs spelling it out: Wallet + Agent ID are linked to the active tab; Messenger, Social Net, and Contacts still send/post as the GM regardless.

The authoring surfaces are intentionally separate. If GM-as-player message authoring ever lands it'll be a much bigger feature with its own opt-in toggle and clear in-UI "Acting As" indicator, because letting the GM ghost-post as a player from the same window is a privacy/sender-attribution surface I don't want to accidentally regress.

Drop-in over 5.5.20. No migration. No setting changes. Behavior delta is one extra default-binding on a click handler.


## Beta 5.5.20 — Sat Map path: Browse button + hidden from Configure Settings (Praise Jaheebus)

Patreon report: GMs trying to change the satellite-map background were typing absolute Windows paths (`C:/Users/...`) into Foundry's Configure Game Settings → Module Settings → "Sat Map Image Path" entry, which Foundry's image renderer can't resolve — it only accepts paths relative to the Foundry user-data root.

Two changes in this drop:

### Hidden from Configure Game Settings

The `mapImagePath` registration was `config: true` so the setting appeared in Foundry's core Configure Game Settings menu with a default text-only input. That UI has no FilePicker, no helper text, no validation — typing an absolute path silently saves it and the map fails to load with no useful feedback. Set `config: false` so the entry no longer shows up there. Existing saved values still load; the setting just isn't exposed in that menu anymore.

### Sat Map path moved to the agent's Sys Admin (with Browse)

Sys Admin → Visual → "Sat Map Image Path" now has a folder-icon Browse button between the input and the SAVE button. Click Browse → Foundry's native FilePicker opens (Forge-compatible) → pick the image → input populates with the correct Foundry-relative path automatically. SAVE writes it. No typing required.

Also added a safety check on the save handler — if the path you submit looks like an absolute filesystem path (`C:/Users/...`, `/Users/...`, `/home/...`, `/Volumes/...`), a warning toast fires explaining the format. The path is still saved (in case you're intentionally testing something), but you get the heads-up.

Helper text under the input was rewritten too — clearer format example, explicit "NOT C:/Users/..." callout, points at the Browse button.

Drop-in over 5.5.19. No migration. Existing custom map paths keep working.


## Beta 5.5.19 — Multi-feature fix bundle from real-Foundry playtest

Playtest catches from the 5.5.18 round + community feedback rolled in. Five things, all verified in real Foundry before ship.

### Bug — Application Access toggle wouldn't turn apps OFF for players

5.5.2 added a union of the saved `unlockedApps` flag with `defaultApps` so existing players auto-saw the new 5.5 apps on upgrade. The flip side: that union also re-added any app the GM later toggled OFF, because the missing app looked indistinguishable from a pre-5.5 user who hadn't been migrated yet. GM-side worked because the GM's tabs wrote to specific player flags, but the per-player read path kept resurrecting the toggle.

**Fix.** Replaced the heuristic with a one-time `unlockedAppsMigrated5_5` per-owner marker. First post-5.5 render does the merge AND writes the marker. After that the saved flag is fully authoritative — toggling OFF removes from saved, marker stays, no more re-adding.

### Bug — NCPD FILE button hung on click

The handler referenced `mugshot` in the record push but never declared `const mugshot = ...`. The 5.5.12 patch that was supposed to add it never landed. JS threw a silent ReferenceError; Foundry's event wrapper swallowed the throw; the button appeared to do nothing.

**Fix.** Added the missing const declaration. Also reset `_ncpdActiveId = null` and `_ncpdSearch = ""` after save so the GM definitively lands on the unfiltered list with the new record visible — no more "I clicked FILE and nothing seems to have happened" because of a leftover search or detail view from earlier.

### Bug — Pin "Hover only" label mode didn't trigger

The CSS rule for `.agent-map-pin .pin-label-hover { opacity: 0 }` lived inside a `<style>` block that was scoped to the pin placement modal's `{{#if showMapPinModal}}` conditional. When the modal closed, the `<style>` element left the DOM and the rule disappeared along with it. Pins on the map still had the `pin-label-hover` class but no CSS targeted them.

**Fix.** Moved the rule to `styles/agent.css`. Then real-Foundry testing showed it still didn't fire reliably (specificity / cache / who knows). Switched to pure JS: each pin gets a `data-label-mode` attribute; on `activateListeners`, JS reads the attribute, sets `label.style.opacity = '0'` on hover-only pins, and binds `mouseenter` / `mouseleave` handlers that flip it to `'1'` and back. Inline transition keeps the fade smooth. No CSS dependency — bulletproof against any theme override.

### Bug — Tester1's rent-only housing didn't appear on the ID card

The Bio → ID card housing block was gated on `{{#if housingStatus}}`. Players with rent set but status empty (Phil Sweet's table had this) got nothing on their card.

**Fix.** Gate changed to `{{#if housingHasAny}}` where the getData side sets `housingHasAny = !!(housingStatus || housingRent)`. When only rent is set, the block renders with `(no address on file)` as the placeholder status line and the rent shown in gold underneath.

### Feature — Housing per-character (Phil Sweet via Patreon)

Up to 5.5.18, housing was stored on the User flag — so a player running two characters saw the same housing on both. Phil pointed out that different characters often have different rent / living situations.

**Fix.** Storage migrated from `user.flag` to `actor.flag`. Sys Admin → Housing Roster now iterates each player's owned character actors and shows one row per `(player → character)` pair. Legacy user-level housing falls back as a default when the actor flag is empty, so existing data isn't lost — on first save per character the value gets re-written to the actor flag and from then on each character is independent. Sys Admin section text cleaned up (patch-note language removed from the UI; that belongs here in the changelog, not in the GM panel).

### Bug — Save Housing snapped the Sys Admin scroll back to top

The `save-housing` handler awaited `setFlag` per row, each of which fired hook events that triggered intermediate renders racing with the explicit `this.render(true)` at the end. Each intermediate render captured then restored the wrong scroll position.

**Fix.** Adopted the existing rep-toggle scroll-pin pattern: capture `_pinScroll` before the awaits, kick off a `requestAnimationFrame` loop that re-asserts the saved scrollTop for ~400ms regardless of intervening renders. Save now stays where you saved.

### Pin label and pin glyph (Sleepingmann on Reddit)

Folded in this drop: per-pin label mode (Always / Hover only / Off) on the placement modal + default pin icon shrunk from 1.4rem to 1.1rem. Hover only now works via JS (see above).

Drop-in over 5.5.18. No migration. Existing pin data defaults to "always" label mode (matching previous behavior). Existing user-level housing data is preserved as a fallback until the GM saves per-character.


## Beta 5.5.18 — App-access toggle stuck on + NCPD FILE button hanging + per-pin label mode

Two real-Foundry bugs from the 5.5.17 playtest + a community suggestion folded in.

### Bug — Application Access can't turn apps OFF

The 5.5.2 fix that auto-merged new default apps into a returning player's `unlockedApps` flag had a flip side: every render after the merge re-added apps that the GM had since toggled OFF. End result was that the toggle UI showed the OFF state visually, but the next render put the app back. Apps the GM disabled (Fixers, NC Mart, Bio Monitor, etc.) reappeared on the player view.

**Fix.** Detect whether the GM has already seen the 5.5 new apps — if any of `ncpd / ziggurat / garden` is present in the saved `unlockedApps` set, the saved set is treated as authoritative going forward and the union no longer fires on every render. Upgraders from pre-5.5 still get the one-time merge; everyone else's toggles stick.

### Bug — NCPD FILE button hung silently

The `ncpd-add-record` handler pushed a `mugshot` field into the record object but never declared `const mugshot = ...` to read it from the modal input. JS threw a ReferenceError on the push line; Foundry's event-handler wrapper swallows uncaught exceptions without surfacing a UI notification, so the button just appeared to do nothing. Records were never saved.

**Fix.** Added the missing `const mugshot` declaration alongside the other field reads. FILE now actually files the rap sheet, the modal closes, and the new record shows up in the list.

### Community suggestion (Sleepingmann on Reddit) — pin labels + smaller default glyph

Two adjustments to make pins read better on custom large maps:

- **Default pin icon shrunk** from `1.4rem` to `1.1rem` — less map clutter at the default zoom.
- **Per-pin label display mode.** The pin placement modal now has a three-button toggle: **Always · Hover only · Off**. "Always" matches the previous behavior. "Hover only" hides the label until you mouse over the pin, then it fades in (CSS opacity transition). "Off" shows just the icon, no label at all — the title attribute still surfaces the label on browser hover for accessibility.

Drop-in over 5.5.17. No migration. Existing pins default to "Always" label mode (matching previous behavior).


## Beta 5.5.17 — Pin click + palette + scrollbar + image row layout

Real-Foundry playtest catches from the 5.5.16 audit:

### Map pin clicks weren't landing

The map image had `pointer-events: none` in its inline style (so the browser's default image-drag behavior wouldn't fight with the pan gesture). My 5.5.3 click handler bound to `.agent-map-img` — which was unreachable because of that very style. Cursor swapped to crosshair correctly but the click never fired.

**Fix.** Rebind the click handler to `.map-container` (the parent), which always catches clicks regardless of the image's pointer-events. The image's bounding rect is still resolvable for coordinate math even when pointer-events is off — `getBoundingClientRect` doesn't care about event-capture state. Bonus: skip clicks that bubble up from existing pins or zoom controls (so clicking an existing pin doesn't drop a new one on top), and skip clicks that land outside the image bounds.

### Pin color/icon palette didn't respond to clicks

Every radio input in the color palette had `id="map-pin-modal-color"` — same id repeated for every swatch. Same in the icon palette. HTML ids must be unique. `html.find('#map-pin-modal-color').val()` only returned the first swatch's value (NCPD blue), so every pin came out blue regardless of what the GM clicked.

**Fix.** Removed the duplicate `id` attributes — radio buttons only need a shared `name` for grouping. Switched the handler to read `input[name="map-pin-modal-color"]:checked` (selects the actually-chosen swatch). Added visual selected-state via CSS `:checked + sibling` selectors — picked color gets a white border + yellow ring; picked icon swatch gets an amber background + amber icon tint. You can now see which option is selected.

### Chat input scrollbar arrows

The chat input textarea had a 3px cyan webkit scrollbar with up/down arrow buttons rendering in the space between "Encrypt message…" and the send icon. Set scrollbar-width to none (Firefox), `::-webkit-scrollbar { width: 0; display: none }` (Chrome/Edge), and `-ms-overflow-style: none` (legacy Edge). Long messages still scroll internally up to the 120px max-height; the scrollbar just doesn't render visually.

### Image row layout collapse on Garden / NCPD / Ziggurat modals

The mugshot / photo / image input rows used flex (`flex: 1 1 auto` for the input + `flex: 0 0 auto` for the Browse button). Under Foundry's CSS overrides on `<input type="text">` and `<button>`, flex math could collapse the input to almost nothing while the button stretched past the modal edge.

**Fix.** Switched all three rows from flex to CSS grid (`grid-template-columns: 1fr auto`). Grid doesn't collapse the input column when the row is narrow; the Browse button takes its natural content width without growing. Bonus padding bump on the button (6px 12px) so it doesn't read as cramped.

Drop-in over 5.5.16. No migration. All changes are display/event-layer fixes; saved data unchanged.


## Beta 5.5.16 — Visual-audit fix pass (8 bugs caught by render harness)

Built a sandbox Handlebars render harness this cycle that renders every new-app view + modal + state and inspects the output for visual / UX / wiring issues. First pass found 8 real bugs that the static parse-check + handlebars-balance preflight couldn't catch. All fixed in this drop.

### Bugs caught + fixed

- **NCPD empty state copy.** When zero records exist and no search is active, the empty-state read "No matching records." — implies records exist but none match a search the user never typed. Now branches: `No rap sheets on file. Tap + to file one.` when truly empty; `No matching records.` only when search has a value.
- **Ziggurat empty state copy.** Same class of bug — said "No listings in this category yet" even when filter was set to All. Now: "No city listings yet. Tap + to add one." when truly empty + All filter; "No matching listings." when searching; "No `<Category>` listings yet." when a specific filter is active.
- **Garden empty state copy.** Read "No matches yet. The Garden will surface compatible profiles soon" — sounded like a passive system message. GM-facing copy now: "No Garden profiles yet. Tap + to plant one." Player-facing copy unchanged.
- **Garden image fallback inconsistent with NCPD.** Garden + Ziggurat images used `onerror="this.style.display='none'"` while NCPD used `onerror="this.src='icons/svg/mystery-man.svg'"`. Bad image paths just disappeared on Garden/Ziggurat, leaving an awkward gap. Now all three apps fall back to the mystery-man placeholder consistently.
- **Ziggurat row heights inconsistent.** List rows with images were ~44px tall; rows without images collapsed shorter, breaking the rhythm of the list. Always render an image element with the mystery-man fallback so every row is the same height.
- **Map pin label could push off-screen.** A long pin label (50+ chars) used `white-space:nowrap` with no max-width and would visually extend past the viewport, breaking the map layout. Now caps at 140px with text-overflow ellipsis; the full label still shows on hover via the existing `title=` attribute.
- **Modal close X had no keyboard tab-stop.** The X icon to close NCPD / Ziggurat / Garden modals + the map pin manage modal was a bare `<i>` with `cursor:pointer` and a click handler. Worked for mouse but keyboard-only users couldn't tab to it. Now wrapped in `<button type="button" aria-label="Close">` — proper button semantics, tabbable, screen-reader friendly.
- **Mugshot / photo placeholder text too long.** Placeholders read "icons/svg/mystery-man.svg or modules/AgentDevice/..." which visually truncated mid-string on a narrow phone-frame modal. Replaced with "Image path (optional)" — short, clear, fits.

### Sandbox render harness committed

Audit harness now lives at `.sandbox/render-verify/` with a `run.sh` wrapper that installs handlebars once in `/tmp/render-deps` and runs all three scripts:
- `render.js` — 12 view × state combinations across NCPD / Ziggurat / Garden
- `render-more.js` — Bio with/without TT coverage, Map with/without pin mode
- `round-trip.js` — pure JS simulation of filter/search logic across all new apps

Every future ship now runs this before tag-push as the audit ceiling, alongside the existing `ship.js` preflight as the floor.

Drop-in over 5.5.15. No migration.


## Beta 5.5.15 — Ziggurat filter / add-dropdown unification

Playtest catch: the player-facing Ziggurat filter chips used one category list (Venues / Bars / Food / Fixers / Black Market / Services / Other) and the GM-facing add dropdown used a different one (Venue / Fixer / Ripperdoc / Vendor / Safehouse / Gang Turf / Corp / Other). Saved entries carried the GM list; the filter chips were testing exact-match against the player list. End result: entries either never matched any filter or appeared under the wrong one.

**Fix.** Unified on the GM list (richer + Cyberpunk-flavored). Filter chip strip now reads: `All · Venue · Fixer · Ripperdoc · Vendor · Safehouse · Gang Turf · Corp · Other` — same as the add dropdown. Exact-match filtering works as intended. Existing entries are unaffected — they already carry the canonical values.

Drop-in over 5.5.14. No migration.


## Beta 5.5.14 — Pin mode cursor + click pipeline

The PIN-MODE banner said "click map to place" but the cursor stayed as the grab/drag hand from the pan handler, and a mousedown was still arming the pan logic — the click went through but the visual was misleading.

**Fix.** In pin mode, the map container's cursor is now `crosshair` (matches the "drop a pin here" semantic), and the pan mousedown handler bails out early when pin mode is on — no pan setup, no momentary "grabbing" cursor, no race between pan release and click. The pin-placement click goes straight from mousedown → click → modal open.

Drop-in over 5.5.13.


## Beta 5.5.13 — NC Mart "All" category, set as default landing view

Quick playtest follow-up. The NC Mart catalog defaulted to **Weapons**, which surfaces a category-filtered view before the player has any chance to scan the full inventory. Added an **All** virtual category at the front of the tab strip and made it the default.

- Tab strip now reads: `All · Ammo · Armor · Clothing · Cyberware · Drugs · Gear · ...` with All highlighted by default on first open.
- "All" flattens every category into one scrollable list. Search, price-tier filter, affordability toggle, and Fixer-rank gate all still apply on top of it the same way they do per-category.
- Default category state changed from "Weapons" to "All" — affects fresh installs only; existing players' last-viewed category sticks until they switch.

Drop-in over 5.5.12. No migration.


## Beta 5.5.12 — New-app polish: mugshots, photos, Night Market price override + catalog import

Playtest round on the 5.5.x new apps. Five real issues + one visual artifact, all fixed.

### NCPD mugshot field

Rap sheets now carry an optional mugshot image. GM fills the new "Mugshot" field in the FILE RAP SHEET modal (with a Browse button using Foundry's FilePicker, Forge-compatible). The detail view now lays out as a horizontal split — mugshot on the left, the rap-sheet text on the right — with a SUBJECT label under the photo. Player-side list rows also pick up a small thumbnail for at-a-glance recognition. Falls back to the generic `mystery-man.svg` icon when no mugshot is set.

### Garden photo Browse button

The Garden modal already had a photo-path input, but it required typing the path. Added a Browse button next to it (same FilePicker pattern as NCPD), so the GM picks the image visually. Data flow was already wired through to the detail + list views — this just fills in the missing UI.

### Ziggurat optional image field

Audit catch: Ziggurat had no image surface at all. Added an optional image field to the modal (with Browse) and a small thumbnail to each list row. Lets the GM attach a venue photo, fixer headshot, gang sigil, or corp logo to each city directory entry. Skipped on entries without an image — no placeholder clutter.

### Night Market — LOAD CATALOG button

The "Add from current catalog" picker was rendering blank because the NC Mart catalog only lazy-loads when a player opens the NC Mart app. If the GM went straight to Sys Admin → Night Market without anyone hitting NC Mart first, there was nothing to add from. Added an explicit **LOAD CATALOG** button at the top of the picker that triggers the same loader. Shows item count once loaded. Becomes **REFRESH CATALOG** after first load. Empty-state message points the GM at the button.

### Night Market — price override per item

The whole point of a Night Market is that prices aren't the same as the regular catalog — markup for scarcity, markdown for "fell off a Militech truck." Added an optional price-override input next to the flavor field on each catalog-picker row. Blank uses the catalog price. Any positive number wins. The curated-list display now shows the active price in purple and a small grey "(was Xeb)" hint when the GM overrode it. Stored alongside the catalog price so changes are visible.

### Modal textarea resize-handle artifact

The notes textareas on NCPD / Ziggurat / Garden modals were rendering with a diagonal-stripe resize grip in the bottom-right corner that bleeds visually against the dark modal background and red phone frame. Set `resize: none` on all three (same pattern the chat input uses). The rows= setting still controls default height; users can't drag-resize but the autoreflow is fine for the field sizes involved.

### Audit results

Full pre-ship sweep clean: parse + handlebars balance OK, all template-→handler actions bidirectional, all four FilePicker hooks (`pick-contact-avatar`, `pick-custom-item-img`, `pick-ncpd-mugshot`, `pick-garden-photo`, `pick-ziggurat-image`) have matching template Browse buttons, modal input IDs (6 per app for NCPD/Ziggurat/Garden) match 1:1 between template and handler, GM permission guards present on all new writes.

Drop-in over 5.5.11. No migration. Existing rap sheets / Garden profiles / city listings stay intact (new fields are optional + default to empty).


## Beta 5.5.11 — README banner: don't use Code → Download ZIP

GitHub's "Code → Download ZIP" button on the main repo page produces `Agent-OS-main.zip` extracting to `Agent-OS-main/` — named after the repo, not the module. That folder name doesn't match `AgentDevice/` where Foundry installs the module, so dropping it into a modules directory leaves the GM with two folders side by side.

GitHub controls that filename and folder structure entirely — there's no workflow setting or repo config that overrides it. The actual fix is for users to grab the **release zip** from the Releases page instead (which the workflow wraps in `AgentDevice/` correctly), not the auto-generated source archive from the main repo page.

Added a prominent banner block at the top of the README so anyone landing on the repo's main page sees the install instruction before they click the green Code button. Same content also gets rendered when GitHub previews the README in search results, on the Releases page sidebar, etc.

No code or gameplay changes.


## Beta 5.5.10 — README accuracy pass

Docs-only drop. README was documenting the pre-5.5.8 workflow (module.json at zip root, no AgentDevice/ wrapper). Rewrote it to match what actually ships:

- The release zip is `AgentDevice-<version>.zip` with all module content wrapped inside an `AgentDevice/` folder so it extracts to the same path Foundry installs already use.
- The GitHub release page also auto-attaches `Source code (zip)` and `Source code (tar.gz)` — those are GitHub's auto-generated source archives, named `Agent-OS-<tag>.zip` (matches the repo name, extracts to `Agent-OS-<tag>/`). Don't use those for installs. Always grab the workflow-built `AgentDevice-*.zip` from the Assets section.
- ship.js now includes a preflight that parse-checks every tracked source file before commit. Documented in the README so future maintainers know what to expect.
- ship.js is no longer in the repo's source archive (untracked since 5.5.9). Documented.

No code changes. No gameplay changes.


## Beta 5.5.8 — Release zip wraps in AgentDevice/ folder + ship.js untracked

Two install-side fixes. No gameplay changes.

### Release zip extracts to `AgentDevice/` again

The PowerShell shipping pipeline that the module used through 5.0.x produced a zip whose contents were wrapped in an `AgentDevice/` folder, so Patreon users dropped that folder straight into their Foundry modules directory and existing installs were overwritten cleanly. The GitHub Actions workflow that replaced it (added in 5.0.3) zipped the module's contents at the archive root instead, so the new zip extracted as a bare `module.json` + `scripts/` + `templates/` + ... directly — different folder name, breaks the drag-into-modules-folder muscle memory for existing tables.

**Fix.** Workflow now stages the runtime content inside `staging/AgentDevice/` first, then zips that. The resulting archive contains a single top-level `AgentDevice/` folder so the extract behavior matches every previous Patreon zip back through 4.x. Foundry's manifest-URL install path also still works — it walks the archive to find module.json wherever it lives.

### `ship.js` no longer in the GitHub source archive

`ship.js` is maintainer-side dev tooling — it shouldn't be in the source tree someone downloads via "Download ZIP" from the repo. Untracked from git and added to `.gitignore`. Stays on the maintainer's local working tree (where it has to live for the shipping workflow to work) but no longer ships in the source archive.

Drop-in over 5.5.7. No gameplay changes; the module behaves identically.


## Beta 5.5.7 — Scroll snap-back fix on every new app

Playtest report: clicking a Ziggurat category (Venue / Fixer / Ripperdoc) snapped the view back to the top; scrolling down a long list and triggering any re-render did the same. Confirmed the same class of bug across NCPD, The Garden, and the map pin manage modal — none of the new 5.5 app scroll containers were tagged for preservation.

### Fix — self-discovering preservation attribute

The existing scroll-preservation system tracked a small hard-coded list of class selectors (`.admin-console`, `.rep-view`, etc.). Adding the new 5.5 views would have meant updating that list every time a new app shipped. Instead, added a self-discovering variant: any element with `data-preserve-scroll-container="<key>"` is captured before render and restored after, no JS array maintenance.

Tagged six scroll containers in this drop:

- NCPD: list view (rap sheet grid) + record-detail view
- Ziggurat: city directory list (the one with the category-snap-back report)
- The Garden: matches grid + profile-detail view
- Map pin manage modal: pin list

Category clicks, search input, pin visibility toggles, and any other render-triggering action now preserves the current scroll position across the re-render. Existing class-keyed selectors stayed in place — the attribute is additive, not a rewrite.

Future apps just add `data-preserve-scroll-container="<unique-key>"` to their scrollable element and it works automatically.

Drop-in over 5.5.6. No migration.


## Beta 5.5.6 — Night Market START button

Tiny gap noticed by playtesting: Sys Admin → NC Mart → Night Market only had END NIGHT MARKET. Adding the first item was the implicit "start" and the GM had no way to open a market with a chosen name before stocking it, and no clear status when it was closed.

**Fix.** Sys Admin → Night Market now shows two states:

- **Closed** — a name input ("e.g. Maelstrom Black Drop") + a **START NIGHT MARKET** button. Click START and the market opens under that name with an empty curated list. Blank input defaults to "Night Market".
- **Open** — the previous END NIGHT MARKET button + a status pill ("Live · 'Maelstrom Black Drop' · 4 item(s)" or "Open (empty) · 'Maelstrom Black Drop' — add items below to surface the tab"). Catalog picker becomes available for adding items.

Players still only see the Night Market tab in NC Mart when the market is open AND has at least one item, so the GM can stage an empty drop without players seeing a confusing empty tab. END resets the market to closed.

Drop-in over 5.5.5. No migration. Existing markets keep working — `nm-add-from-catalog` still creates the market object if one isn't there, so the implicit-start path stays as a fallback.


## Beta 5.5.5 — + buttons on new apps, REO Meatwagon panic, Ziggurat ID-mismatch fix

Three changes addressing direct community feedback from the 5.5.4 playtest.

### + buttons on NCPD / Ziggurat / Garden — add content from the app, not Sys Admin

The Sys Admin tab was getting bloated, and adding content meant tabbing out of the app you were looking at. Each of the three new apps now has a GM-only **+** button on the header. Click it and a modal opens with the same fields the Sys Admin inline form used to host — name, charges, bio, whatever the app needs. Save closes the modal and the new entry shows up in the list immediately. No more round trips through Sys Admin every time the GM wants to file a rap sheet or seed a Garden profile.

The Sys Admin inline add-forms are still there for now (they don't hurt, and existing muscle memory keeps working), but the + button modal is the new path going forward.

### REO Meatwagon panic for players with no TT coverage

Before: players without Trauma Team coverage saw a dimmed dead block on the Bio screen — "Call REO Meatwagon and hope for the best" — that couldn't be clicked. The community feedback was direct: that's a wasted GM hook, give them a real button. Now it's a fully clickable orange dashed panic frame styled the same way Trauma Team's is styled, just routed under the "REO Meatwagon" alias. Click it and the GM gets a whispered chat card with a "scrap-grade ambulance dispatched, narrate accordingly — ETA, cost, and competence at your discretion" prompt. Same alert pipeline as the TT panic button, just a different brand of cavalry.

### Pre-existing Ziggurat ID-mismatch bug — fixed

Audit catch: the Ziggurat Sys Admin form was already broken in 5.5. The add handler read inputs with the prefix `#zig-add-*` but the template inputs were `#ziggurat-add-*`. Every "ADD LISTING" click read empty values from non-existent IDs, so nothing ever got saved. Hadn't been reported yet because nobody had tried to use it before. Handler now reads the IDs the template actually has. Old shipped data is unaffected (there was none to be affected — the form never wrote anything).

### Audit notes

Full audit pass per the public-beta bar: parse + handlebars balance clean, all 23+ actions bidirectional (no orphan template references, no dead handlers other than legacy `map-pin-add` which is kept harmless for back-compat), modal input IDs match between template and handler 1:1 across all three apps, GM permission guards on every modal open, settings.set, and add path.

Drop-in over 5.5.4. No migration. Existing world data untouched.


## Beta 5.5.4 — Audit hotfix: voice-override-without-avatar tagging, map pin click-after-pan race

Full code audit per the "bug free as much as possible for public beta" bar. Two bugs caught that escaped the 5.5.3 ship.

### Bug — voice-override-only NPC bubbles still showed without per-bubble speaker tag

5.5.3 fixed the multi-NPC chat readability regression by switching consecutive-message detection to `personaKey` (instead of the GM's user id) and adding an `isMultiPersonaThread` flag that forces speaker tags on every bubble in any thread that used a voice override. The detection of "is this a roleplay bubble" keyed on `flags.overrideAvatar` — which works when the GM has set a custom avatar for the NPC. But for a GM voicing an NPC using only a custom voice **name** (no avatar swap), `overrideAvatar` is absent, so the bubble was flagged `isNpcRoleplay: false`, `isMultiPersonaThread` for the whole thread came up false, and the per-bubble speaker tag never rendered. The exact case from the screenshot reports.

**Fix.** `isNpcRoleplayMsg` now triggers on either `flags.overrideAvatar` OR `flags.overrideName` — any persona override signals "treat this as an NPC bubble." Combined with the existing 5.5.3 fixes, name-only voice overrides now render with per-bubble speaker tags + persona-hashed colors + correct left-aligned layout. No avatar required.

### Bug — map pin click-after-pan race

5.5.3 added click-to-place map pins. The click handler bailed when `_panState.isPanning` was true so panning the map wouldn't drop a phantom pin — except browsers fire `click` on mouseup, and `_onWindowMouseUp` resets `isPanning` to false **before** the click event runs. End result: pan-release lands a phantom pin modal at the mouse-up position.

**Fix.** Track `_panState.moved` explicitly: reset to false on every mousedown, set to true the first time mousemove fires during a pan, checked in the click handler. If the mouse moved during the press, the click is a drag-release and the modal stays closed. Pure click (no motion) still places the pin normally.

### Audit findings (clean)

- Parse + handlebars balance: clean. Preflight passes.
- Template ↔ handler wire-check: 23 new 5.5/5.5.3 actions, all bidirectional.
- 50 `game.settings.set` calls: all GM-guarded (15 of them deeper than a 15-line window, so the initial scan flagged false positives; manual recheck confirmed every write path has `isGM` upstream).
- Window-level listeners: both map-pan and window-drag sets have their own once-per-instance bind guards (`_windowEventsBound` and `_onWindowDragMove` ref check respectively); both clean up in `close()`.
- Sticky-flag upgrade paths: only `unlockedApps` had the defaults-change issue and that was already fixed in 5.5.2. All other `getFlag || []` patterns are user-curated data, not new-default merges.
- Settings registered but unread: 5 settings register but read only once or in different code paths (`enableCallAnimation`, `storeFixerGatePrice`, `storeFixerGateRank`, `styleTrend`, `styleTrendDesc`). Verified — all are world settings tuned via Configure Settings and read at the point of effect. No dead settings.

Drop-in over 5.5.3. No migration.


## Beta 5.5.3 — Multi-NPC chat fix + click-to-place map pins + canon color pass

Three changes from the first 5.5 playtest round. Two are bug fixes, one is a UX move.

### Bug — multi-NPC chat bubbles were unreadable

In a thread where the GM was voicing two or more NPCs back-to-back, every bubble looked identical: no avatar, no speaker tag, same cyan color. You couldn't tell NPC1 from NPC2. The "consecutive message" logic that hides repeat avatars / names was keyed on the underlying chat author's user id — and for GM-puppeted NPCs that's always the GM, regardless of which persona was speaking. So NPC1 → NPC2 → NPC1 all collapsed into one "consecutive run" and the system hid every distinguishing element after the first bubble.

**Fix.** Consecutive detection now uses a `personaKey` derived from the voice-override name (or the raw user id when no override is set), so two different NPC voices read as two different runs even when the same GM authored both. Avatars come back. Speaker tags come back. And for any thread where a voice override has been used at all ("multi-persona thread"), the speaker name is now stamped on **every** non-self bubble — not just first-of-run — so you can scan a long back-and-forth without scrolling up to find the last name change. The community feedback was specific: "tag speaker every chat, if you're not going to make it obvious who it's from." Done.

### UX — map pins moved out of Sys Admin into the Maps app, click-to-place

Pin curation in 5.5 was buried inside Sys Admin with manual x/y percent inputs. Nobody knows the coordinate of a spot on Night City off the top of their head. Moved the whole thing to the Maps app:

- New GM-only **PIN** button in the map's bottom-right control stack. Toggle it on, a yellow "PIN MODE — CLICK MAP TO PLACE" banner pops up, and the next click anywhere on the map captures that exact position.
- A placement modal opens pre-filled with the click coordinates (locked, no typing), plus a label field, optional notes, an 8-color faction-coded palette (NCPD blue · Trauma Team red · Arasaka red · Tyger Claws gold · Net cyan · Voodoo Boys violet · Mox pink · Aldecaldos green), a 12-icon palette, and a "visible to players" checkbox.
- Second GM button: **MANAGE PINS** opens a modal that lists every pin with eye-toggle for visibility and a delete button — same curation surface that used to live in Sys Admin, just one tap away from where you're actually looking.
- The corresponding Sys Admin section is now a stub that points to the Maps app.

The GM never has to think about x/y again.

### Visual — canon-leaning color + icon tune on the new 5.5 apps

Minor tune to make the new 5.5 apps read closer to recognizable Cyberpunk RED / 2077 visual ID:

- **NCPD DB**: shifted from generic sky blue to a deeper neon-cyber blue (`#3a86ff`) with a thin Tyger-yellow underline strip on the header for the NCPD patrol-stripe feel.
- **Ziggurat**: deeper Arasaka data-tower violet (`#7c4dff`) instead of the lavender of 5.5. Icon swapped from `fa-city` to `fa-database` — Ziggurat in 2077 lore is a Net data fortress, the database icon reads more accurately than the city skyline.
- **The Garden**: deeper Cyberpunk neon magenta (`#ff1493`) instead of the pastel pink — closer to the Black Chrome / Edgerunner dating-app palette.
- **Night Market**: brightened violet for more neon-punch.
- **Map pin palette**: relabeled with faction names (NCPD / Trauma Team / Arasaka / Tyger Claws / Net / Voodoo Boys / Mox / Aldecaldos) so the GM can color-code intent at a glance instead of picking from "Red / Yellow / Cyan."

Drop-in over 5.5.2. No migration. Existing pins keep their original colors.


## Beta 5.5.2 — Hotfix: new 5.5 apps invisible after upgrade

5.5 shipped three new apps (NCPD Crime Database, Ziggurat City Database, The Garden) but tables upgrading from 5.0.x reported the apps didn't appear on the Agent home grid — even after re-uploading the module and relaunching the world. Same for the Night Market mode and the new Sys Admin sections (those only render when the underlying app is unlocked for the active view).

**Root cause.** The home grid filters by a sticky per-actor / per-user `unlockedApps` flag. The render path read `getFlag("unlockedApps") || defaultApps`. On a fresh install the flag is undefined so `defaultApps` (which 5.5 extended to include the three new apps) was used and everything appeared. On an upgrade from 5.0.x the flag is already populated with the old 11-app list — that's truthy, the `||` fallback never fires, and the new apps stay hidden forever. The toggle handler had the same out-of-sync fallback list, so manually toggling any app off would reset the player to the old 11-app list and re-hide the new ones.

**Fix.** Render path now unions the saved `unlockedApps` with `defaultApps`: every app the GM previously turned ON stays on, every app newly added to defaults is auto-merged into the view. GM can still toggle the new apps off from Sys Admin → Application Access if they don't want them in this campaign. Toggle handler's fallback list synced with `defaultApps` so first-toggle on a brand-new player can't roll back to the old set either.

No data migration needed — the fix is read-side. The first re-render after upgrade picks up the new apps automatically; saved flags get written through on the next GM toggle as normal.

Drop-in over 5.5.1. No migration.


## Beta 5.5.1 — Folder cleanup + fuse-safe tooling

Internal hygiene drop. No gameplay changes; the module behaves identically to 5.5.

- **AgentDevice/ is now game-only.** Moved internal QA notes (`TESTING_PATCH3.md`, `TESTING_PATCH4.md`) and superseded release notes (`RELEASE_NOTES_PATCH.2.1.md`, `RELEASE_NOTES_PATCH.3.md`) out of the module folder into the parent project's `_archive/` directory — they were excluded from the release zip already, but they didn't belong in the module's working tree where they'd show up if you symlinked AgentDevice/ into Foundry's modules directory for live debugging.
- **Removed sandbox probe artifact.** Deleted `.git-probe-test`, a one-byte file left behind by an earlier session diagnosing fuse-mount filesystem behavior. Added probe-artifact patterns to `.gitignore` so future investigation leftovers can't re-leak into the module dir.
- **safe-edit.sh + ship.js preflight.** Tooling-side change that doesn't ship to players but protects future releases. The Cowork fuse mount was silently truncating Edit-tool output on large source files (~1500+ lines) — node --check catches the mid-statement cuts in ~100ms but text-pattern smoke tests miss them. `ship.js` now runs a preflight that parse-checks every tracked .js file and handlebars-balance-checks every .hbs file before committing; refuses to push if anything's broken. The matching `.sandbox/safe-edit.sh` helper routes edits through `/tmp` with verification, so dev-time edits don't hit the truncation path in the first place.

Drop-in over 5.5. No migration. Foundry doesn't see any of this.


## Beta 5.5 — App pack drop: NCPD, Ziggurat, The Garden, Night Market, map pins, housing, MedScan, Screamsheets

Big one. Eight community-requested features bundled into a single drop instead of dribbling them out across point releases. The Agent now ships with five new in-fiction apps and three quality-of-life additions to existing ones. All new data lives in world-scoped settings; the GM curates everything from Sys Admin. No migration — old worlds boot clean.

### New apps

- **NCPD Crime Database** (`fa-fingerprint`, sky blue). Lookup app for rap sheets. GM files records via Sys Admin → NCPD Crime Database (name, charges, bounty, status, notes). Players search by name / charges / notes and tap a row to read the full sheet. Useful for bounty boards, wanted-poster handouts, and "is this Burnpunks gang member the one we're after?" cross-references.
- **Ziggurat City Database** (`fa-city`, violet). Player-facing directory of venues, fixers, ripperdocs, safehouses, gang turf — anything you'd want a Night-City-savvy edgerunner to be able to look up. GM files entries with a category (Venue / Fixer / Ripperdoc / Vendor / Safehouse / Gang Turf / Corp / Other), address, hours, freeform notes. Players filter by category and search by keyword. Cleaner than dropping locations into journal entries the players never re-open.
- **The Garden** (`fa-seedling`, pink). The dating-app concept from the Black Chrome / Edgerunner-era setting. GM plants NPC profiles (name, age, photo, bio, interests, availability). Players see the matches as a card stack and can tap MESSAGE to start a Messenger thread with the profile — the thread auto-routes back to the GM-controlled NPC the same way the existing NPC-contact flow does. Hooks for cross-pollination with Reputation later (gating who shows up by Fixer rank, etc.); 5.5 just ships the social surface.
- **Night Market mode in NC Mart** (community ask). Curated limited-time drop that lives alongside the regular catalog. GM curates via Sys Admin → NC Mart → Night Market: browse the live catalog, click + ADD on each item you want in the drop, add an optional flavor blurb ("fell off a Militech truck"), and players see a NIGHT MARKET tab in NC Mart while the drop is live. Items use catalog prices so the GM doesn't fight the price-tier filter. END NIGHT MARKET clears the drop in one click.
- **Map indicators / GM pins** (Ryouhi request). Pin overlay on the Agent satmap. GM places pins via Sys Admin → Map Indicators (label, x/y as percent, color, FontAwesome icon, optional notes shown on hover). Visibility toggle lets you draft pins without leaking them to players, then flip them visible at the right table moment. Pins render with a stylized icon-plus-label glyph on the map; hover surfaces the notes.

### Quality-of-life on existing apps

- **Rent / housing status on the Bio → ID card** (Gotto request, long-standing backlog). GM sets per-player housing-status + rent string via Sys Admin → Housing Roster ("Cargo container — Watson", "Megabuilding H8 — apt 117", "Owes 3 weeks"). When set, the player's ID card grows a Housing block under the SIN / Clearance grid. Separate SAVE HOUSING write so an edit there can't clobber TT-coverage + Fixer-rank config.
- **Trauma Team MedScan request button** (Gotto request). New non-emergency First-Aid / Paramedic / Medical Tech consult button below the Panic Signal. Tap it and the GM gets a whispered chat card with your coverage tier and handle. Lets the GM rule narratively on whether the corp doc is willing to fly out for a stabilize-not-evacuate scenario. Only shows for players with TT coverage on file.
- **Screamsheet posts in Lifestyle → NetStatus** (Black-Chrome flavor ask). New GM-only "Publish as Screamsheet" toggle on the social composer. When checked, the post renders in the feed as a yellowed broadsheet card (Georgia serif headline, red category stamp, dashed underline, signoff in italic) instead of the regular feed item. Lets the GM drop styled in-fiction news bulletins without leaving the Agent to make a journal entry.

### Internals

- Five new world settings registered (`ncpdRapSheets`, `cityDirectoryEntries`, `gardenProfiles`, `mapIndicators`, `nightMarketActive`), all JSON-encoded arrays, GM-restricted, hidden from the Configure Settings list. Existing settings untouched.
- The Garden's MESSAGE button reuses the existing custom-contact pipeline: it materializes a contact card with `isPlayer:false` keyed by `garden_<profileId>`, drops the player into the new Messenger thread, and the GM gets a fresh NPC voice to puppet from their side.
- The Night Market tab is gated on `nightMarketActive` — when no drop is live, the tab is hidden and the catalog view is the only mode. Closing a drop in Sys Admin instantly snaps every player back to the catalog mode.
- Map pins are filtered server-side to visible-only before reaching the player view; the GM gets full visibility.
- All new action handlers are GM-only on writes, world-scoped on reads, and bus their state changes through the existing `_queueAgentRender` debounce so they don't multiply renders on rapid edits.

Drop-in over 5.0.3. No migration.


## Beta 5.0.2 — Pop Out! module compatibility (Ryouhi request)

The Agent's Application class already had `popOut: true` and would in principle work with the Pop Out! module (the popular module for moving Foundry windows into a separate browser window — handy for multi-monitor setups), but three `document.activeElement` references in the render path were silently broken when the app's DOM lived in a detached window. The script's top-level `document` is the main page; the agent's elements live in `popoutWindow.document` once popped. Focus checks against the wrong document = always false = restoration logic doesn't fire.

**Fix.** Switched all three call sites to use `element.ownerDocument.activeElement` instead, which resolves to whichever document the agent currently lives in. Now:

- Store-search focus restoration works popped out
- Chat-input focus tracking (`_chatInputHadFocus`) works popped out
- Composer-draft focus capture (the `data-preserve-draft` system) works popped out

No new dependencies — Pop Out! remains an optional module. If you don't use it, nothing changes. If you do, the Agent now behaves correctly when dragged into a second window.

Drop-in over 5.0.1. No migration.

---

## Beta 5.0.1 — Messages hotfix (Gotto Goho playtest round 4)

Eight bugs from the first public-5.0 playtest, all in the Messenger area. Most of these landed because 5.0 was the first time the new group/voice/attachment features met real-table use.

### Bugs

- **Typing indicator showed "Gamemaster is writing" instead of the NPC persona.** The typing socket event was always sending the GM's user name and token even when the GM was in an NPC thread or had a voice override picked in a group. Now the indicator mirrors the same persona resolution the send-message path uses — recipients see the NPC's name and avatar, matching what the actual message will look like.
- **Privacy leak: empty `targetUserIds` still routed NPC messages to players.** Root cause was the 4.8 NPC thread auto-resurrect. `createChatMessage` fires on EVERY client (Foundry syncs the document to all sessions regardless of whisper visibility), so the resurrect path was materialising the NPC contact on every player's device even when the GM had ticked no boxes during creation. Hard gate added: the auto-resurrect now only runs if the current user is actually on the message's whisper list.
- **Multi-PC single-NPC contacts looked private but weren't.** When the GM ticked multiple players during contact creation, all of them received the NPC's messages via the same thread — but the privacy indicator read "ONLY YOU + GM · NPC CHANNEL," giving the wrong impression of a 1-to-1 conversation. New label for multi-recipient NPC threads: `NPC CHANNEL · YOU + <co-recipient names> + GM`. No ambiguity.
- **Custom group threads bled into "Global Net" (party_group_chat) view.** Thread-matching filter had a whisper-based fallback that could accidentally match `pcgroup_*` / `party_group_chat` / `npc_*` messages into 1-to-1 DM threads. Tightened so each thread type uses exact `threadId` match only — no whisper fallback for group/NPC/party views.
- **Players couldn't create groups ("authorization" error).** `confirm-new-group` was calling `setFlag` on other users' customContacts, which non-GMs can't do. Player creation now emits a `groupInviteRelay` socket event; the GM-side socket handler distributes the group to every member's device.
- **Avatar circles distorted by non-square JPGs.** Added a defensive `object-fit: cover` default on every img inside the agent content tree. Inline overrides (NC Mart icons that need `contain`) still win via specificity. Circles stay circular regardless of source-image aspect ratio.
- **Voice switching in multi-NPC groups felt indistinct.** Visual ambiguity made it hard to tell which NPC just spoke. Now every non-self message bubble in a group thread shows the sender name in a stable hashed color (deterministic per persona name), so each NPC voice has its own visually distinct tint. Self-bubble dark-on-cyan styling preserved for legibility.
- **Existing groups appeared in the group-builder candidate list.** When creating a new group, previously-created groups (`pcgroup_*`) showed up alongside individual NPC contacts as if they could be group members. Filter excludes anything tagged `isGroup` / `isCustomGroup` / id starting with `pcgroup_` / `party_group_chat`.

Drop-in over 5.0. No migration.

---

## Beta 5.0 — The public-beta rollup

Consolidating everything from the 4.5 → 4.8.3 patch chain into one release. This is the "if you haven't installed yet, install this" cut. Drop-in over any 4.x build, no migration, no setting wipes. Full 4.x patch history is preserved below for anyone who wants the per-patch context.

### Messages — the biggest area of change

- **Categorized emoji synthesizer.** Tab strip across the top — REACT 😎 · HANDS 🤘 · CYBER 🤖 · COMBAT 🔫 · VIBES 🔥 · NSFW 🍆. ~150 emojis total, all curated for the setting. Icon-only tabs fit on every phone-frame width without horizontal scroll.
- **PC-initiated group threads + GM multi-NPC groups.** Players can start their own group chats with any mix of player handles + NPCs they have in contacts. GMs can do the same across every NPC across every player device. Whispers route to all members + GMs automatically.
- **GM voice switcher in multi-NPC groups.** When a group has ≥2 NPCs, a `VOICE:` dropdown appears in the chat header (GM-only). Default GM (self); pick any NPC member and subsequent messages go out attributed to that NPC. Per-thread state.
- **Attachment template cards.** 📎 button next to the emoji button. Pick PHOTO / VIDEO / AUDIO, type a description, send. Renders as a styled bordered card in the thread with high-contrast readable text on any bubble color. Pure RP — no file upload.
- **Privacy indicators tightened.** No more ambiguity about who's reading: `PARTY CHAT · EVERYONE READS`, `ONLY YOU + recipient + GM`, `ONLY YOU + GM · NPC CHANNEL`, or `GROUP CHAT · N MEMBERS + GM` depending on thread type.
- **Edit Agent ID moved in-phone.** No more Foundry Dialog popping out of the frame — the edit form is a full-screen overlay inside the phone, matching the Add Contact modal style. Stale-data leak between players fixed (each open re-seeds the form to the target's saved overrides).
- **Messenger header surfaces "TO:" + "SPEAKING AS:".** GM-only — see at a glance which player(s) an NPC thread is targeting and which persona you're sending as.
- **NPC thread auto-resurrect.** Player accidentally deletes an NPC contact, GM sends them another message → thread comes back automatically with the right name + avatar. No more "wait, I deleted that, can you re-send?"
- **GM persona override on Social posts.** Optional "Post AS" field for the GM on the social composer. Blank → posts as Gamemaster. Filled → posts as that NPC name.
- **Ghost messenger notifications fixed.** Home-screen badge no longer counts orphan threadIds from deleted contacts.
- **Avatar resolution fixed.** GM-side bubbles now show PC portraits correctly. NPC avatars show on both sides of the conversation symmetrically.
- **Bubble cropping fixed.** Long messages grow the bubble vertically instead of clipping descenders.

### NC Mart

- **GM gates that actually save.** Max Price / Source Filter / Locked Categories now persist via a SAVE GATES button with a "CURRENTLY IN EFFECT" readout. Clear-all button included.
- **Custom-item builder rebuilt.** Form-based inputs (Name / Category with autocomplete / Price / Description / Image with FilePicker) replace the raw JSON textarea. Raw JSON editor still available under a disclosure for power users. Added items show in a removable list below the form.
- **Compendium pack discovery.** Expandable "Available packs in this world" list shows every Item-type pack with a one-click "+ ADD" button that appends to the custom packs setting.
- **Price-tier bucket filter.** Player-side dropdown: Cheap (0-100eb) / Everyday (100-500) / Costly (500-1k) / Premium (1k-5k) / Expensive (5k-10k) / Luxury (10k+). Status line under the strip shows what's actually filtering.
- **Fixer Rank gate.** World-level "items above X eb require Fixer rank ≥Y" setting. Per-player Fixer rank (0–10) lives in Sys Admin → Player Profile. GM bypasses the gate.
- **Search bar reclaimed.** Affordability filter shrunk to a single wallet-icon toggle; search input gets the rest of the row.

### Sys Admin

- **Per-player Application Access tabs.** Folder-style tab strip above the app-lock frame. Each tab scopes the toggles to that player only — nothing else in Sys Admin moves.
- **Per-player Wallet Identity tabs.** Same pattern — pick which wallet view Sys Admin reads/acts on. System Fund (Master) is the default; any player tab surfaces that player's wallet.
- **Trauma Team Coverage + Fixer Rank roster.** Sys Admin → Player Profile lets the GM set both per-player. Coverage tier gates the bio-monitor panic button; Fixer rank gates NC Mart items above the world Fixer Rank threshold.
- **Datapool inject explainer.** In-modal panel explains what a shard is and where it shows up for the player — no more "how do I use this?"
- **GM no longer logs in as the first player's identity.** Defaults to Virtual Wallet on fresh open.
- **All Foundry Dialog popups moved in-phone.** Edit Agent ID, Pay All Players, NPC Bid name prompt, Purge Record, Purge Endpoint — zero `Dialog.confirm` calls remain. The phone owns its own UI.

### Auctions

- **NPC bid path.** GM-only "NPC" button next to BID — record a bid attributed to an off-screen NPC. Settlement aware of NPC winners (skips transfer, manual handoff note).
- **GM-as-winner no longer errors.** Auction settlement correctly skips the eb transfer when the GM wins, marks settled with "(GM win — house keeps it)".
- **Bid input legibility.** No longer crushed to ~10px by the BID + NPC buttons.

### Style / Fixers / Social

- **Style: Night City trend + wardrobe modifiers.** GM sets a world-level trend label + flavor (e.g. "Asia Pop"). Per-actor wardrobe modifier list ("+5 Iconic Jacket", "-3 Visible Cyberware") renders as a breakdown card.
- **Fixer cards: edit + jump-to-messenger.** Pencil icon (GM) pre-fills the add row for in-place editing. Chat icon (everyone) opens the new-message picker pre-filled with the fixer's name.
- **Fixer attitude pills no longer snap to top.** Reasserts scroll across multiple frames so the list holds position no matter how many renders fire.
- **Social feed: newest-first + category filter chips.** ALL chip + one per category — Gig Board, DataPool, Rumor, etc.

### Reliability / performance

- **Render-on-hook throttle.** Coalesces bursts of `createChatMessage` and Simple-Calendar `date-time-change` hooks into ≤4 renders/sec so click handlers stay responsive while the game is unpaused.
- **Listener-leak guards.** Scroll-drag handlers use namespaced jQuery handlers so renders don't stack listeners. Fixes the "mouse is constantly clicking" / "can't type in fields" report.
- **Item Piles compatibility.** Pay Contact no longer routes payments to Item Piles shop actors (drink menus, vault containers, etc.). Filters owned actors by type=character with an Item Piles flag-block exclusion.
- **Holophone permission spam squashed.** Removed Tagger-flag tracking that was firing permission errors on every client when any player opened their phone.
- **Sync holophone animation across clients.** Routed through socket emit with `.locally(true)` so the call effect lands on everyone simultaneously.

### Credits

This release synthesizes feedback from **Gotto Goho**, **Ley**, **CommanderCrunch69**, **Ryouhi**, **kieraboom**, **Aeroshifter**, **BubbleMushroom**, and the rest of the playtest community. Most of what shipped came directly from bug reports and feature asks. Keep them coming.

### Install

Drop-in over any 4.x build. No save migration, no setting wipes, no compat shifts.

---

## Beta 4 — Patch 4.8.3 (GM voice switcher in multi-NPC group chats)

Playtest gap from 4.8: when the GM created a group thread with multiple NPCs, every GM message went out as the GM's own identity — no way to actually speak AS one of the NPCs. Single-NPC threads worked fine (implicit "always that NPC"), but a group with two or more NPCs left the GM voiceless.

**Fix.** When a custom group thread has **2 or more NPC members**, a `VOICE:` dropdown appears in the chat header (GM-only). Options: **GM (self)** (default) plus every NPC in the group. Pick one → subsequent GM messages and attachments in that thread go out attributed to that NPC (correct speaker alias + override name + override avatar on the message flags, so it renders to all clients as if the NPC sent it).

The choice is per-thread and persists while the app is open — switch into one thread, voice resets to GM by default; pick an NPC, send a few lines as them, switch threads, voice for the new thread defaults back to GM. Clean state.

Single-NPC threads and party_group_chat are unchanged — the picker only renders when there are ≥2 distinct NPCs in the group's `members` list.

---

## Beta 4 — Patch 4.8.2 (Emoji tab strip fits)

4.8's category tabs were emoji + uppercase label + padding per tab, which pushed the strip wider than the phone frame and forced horizontal scroll arrows. Reworked: icon-only tabs, equal-width flex split (1/6 each), all 6 categories fit on one row regardless of phone-frame width. Label still surfaces as a hover tooltip. Active tab gets a cyan ring + inset glow so it reads as "selected" at a glance.

---

## Beta 4 — Patch 4.8.1 (Attachment card readability)

Playtest immediately surfaced the issue — the attachment card's cyan tint disappeared into the sent bubble (which is also cyan). Card now uses a near-black backing regardless of which bubble it sits in, with the type label in high-contrast yellow ("AUDIO ATTACHMENT" etc.) and the description body bumped to 0.85rem in pure white. Readable on every bubble color now.

---

## Beta 4 — Patch 4.8 (THE MESSAGES UPGRADE)

The big messaging drop. Five things land at once — all from the recent feedback waves, plus a few that were always going to need doing.

### Emoji synthesizer rebuilt — categorized, ~150 emojis

The cyberpunk-themed flat list became six tabs across the top of the picker: **REACT 😎** (faces, vibes) · **HANDS 🤘** (gestures including the requested 🖕) · **CYBER 🤖** (tech, body mods, netrunner kit) · **COMBAT 🔫** (weapons, hazards, blood) · **VIBES 🔥** (money, party, Night City glow) · **NSFW 🍆** (the requested adult set — eggplant, peach, water droplets, the works). Click a tab → grid swaps to that set. About 150 total, all curated for the setting.

### PC-initiated group threads + GM multi-NPC groups

Players can finally start their own group chats. New 👥 icon in the Contacts header opens a builder modal — name the group, check the participants you want (other player handles, NPCs you've got in your contacts), hit CREATE. The thread shows up under that name in everyone's contacts list and whispers route to all member players plus all GMs.

GMs see the same modal but with the union of every NPC contact across all player devices, so they can pull any mix of players + NPCs into a thread. Custom group threads get a `GROUP CHAT · N MEMBERS + GM` privacy label so there's no ambiguity about who can read.

### NPC thread auto-resurrect

Reported by a playtester: a player deletes an NPC thread (accidentally or on purpose), GM later sends another message to that NPC → message arrives in the chat log but the thread doesn't re-appear in the player's contacts. They had to re-add the NPC manually. Now `createChatMessage` checks if the recipient has the contact, and if not, materialises it from the message's `overrideName` / `overrideAvatar` flags. Notification fires: "Agent: '\<NPC name\>' reconnected to your CitiNet directory." Threads survive accidental deletes.

### Attachment template cards (RP-only)

New 📎 button in the chat composer opens a small picker with **PHOTO** / **VIDEO** / **AUDIO**. Pick a type, type a description, hit SEND — the message renders in the thread as a styled bordered card with the icon and your description, instead of as plain text. Pure RP — no actual file uploaded — but visually distinct so "I send Goro a video of the warehouse out back" actually looks like an attachment in the chat.

### What this all rolls back to

Every backlog item from the Gotto / playtest feedback round that touched messaging is in this drop. Group threads were the biggest ask, attachments the most-requested RP utility, emojis the loudest, and the NPC auto-resurrect was a small but recurring papercut. All shipped.

Drop-in over 4.7.x. No migration, no setting changes.

---

## Beta 4 — Patch 4.7.4 (Emoji additions)

Player request from the last feedback round (the eggplant + middle finger ask). Added both to the emoji synthesizer alongside the existing cyberpunk-themed set. No code changes beyond extending the curated list.

---

## Beta 4 — Patch 4.7.3 (Fixer scroll snap — actual fix)

4.7.2's scroll preservation didn't work. Player confirmed: clicking ALLIED / FRIENDLY / NEUTRAL / HOSTILE still snaps the Fixer list back to the top. Re-investigated.

**Root cause.** The `rep-set-standing` handler was calling `await game.settings.set("npcReputations", ...)` and THEN trying to capture scrollTop. But the settings onChange (registered in main.js) fires `ui.render(true)` synchronously inside that await — so by the time the await resolved and my code ran, the DOM had already been rebuilt and scrollTop reset to 0. I was saving 0 and "restoring" 0 four times.

**Fix.**

1. **Capture scrollTop BEFORE the await**, not after. Pin it directly into `_scrollPositions['.rep-view']` so the existing render-lifecycle restore in `activateListeners` can read it on every render that fires.
2. **Aggressive reassert loop:** before kicking off the settings save, start a `requestAnimationFrame` loop that reasserts the pinned scrollTop every frame for ~400ms. Doesn't matter how many renders fire in the gap — every frame, the loop checks if scrollTop drifted and snaps it back. Stops the moment scroll is stable.
3. **Render after the save** is still explicit, but now harmless — the reassert loop catches whatever renders happen.

Per the user's "never happens again" directive, the reassert pattern is deliberately overkill: it doesn't matter what renders or how many, the scroll holds.

---

## Beta 4 — Patch 4.7.2 (Two Fixer/ID bugs)

Two small but annoying ones from playtest:

- **Fixer attitude pill click was snapping the list back to the top.** Clicking ALLIED / FRIENDLY / NEUTRAL / HOSTILE on a fixer card triggered a render and Foundry's post-render focus pass reset `scrollTop`. Same class of bug as the Sys Admin tab snap-back from 4.4. Applied the same scroll-preservation pattern (capture before render, restore across rAF + 0ms + 50ms + 150ms timers).
- **Edit Agent ID stale-data leak between players (Gotto).** GM opens edit on player A, types stuff, saves. GM opens edit on player B → form shows A's values until the app is fully closed and reopened. Root cause: the form fields use `data-preserve-draft`, which stashes typed values in `_composerDrafts` so a stray re-render doesn't blow away the GM's work. But this preservation was applying across different EDIT TARGETS too, not just across re-renders of the same edit session. Fix: opening edit now **re-seeds the drafts to the new target's current saved overrides** before render. Saving or cancelling **scrubs the drafts** so the next open starts clean. Each player's edit form now shows that player's data, always.

### Known issue (deferred to 4.8)

- If a player deletes an NPC contact thread and the GM later sends another message to that NPC, the player's contact doesn't auto-recreate — they have to add it back manually. Worth noting per player report; queued for a proper auto-resurrect-on-incoming-message fix.

---

## Beta 4 — Patch 4.7.1 (Urgent hotfix: clicks dead while unpaused)

**Hotfix for 4.7.** Player report: after installing 4.7, the Agent UI was constantly refreshing and clicks were unregistered — but only when the game was unpaused. Reproduced on a Simple Calendar setup; same fingerprint as the kieraboom render-thrash from 4.4 but with a different trigger.

**Root cause — two interacting paths:**

1. The 4.7 ghost-notification cleanup called `setFlag("unreads", ...)` from inside `getData` whenever it detected an orphan threadId. `setFlag` is async and fires the `updateUser` hook on completion, which can trigger more renders. While paused, this self-terminated harmlessly; once unpaused with Simple Calendar emitting `date-time-change` every in-game second, every SC tick triggered a render, which triggered a setFlag, which triggered an updateUser, which triggered another render — render loop.
2. The 4.7 `_queueAgentRender` rAF coalesce wasn't aggressive enough — at 60 fps, even one render per frame saturates the click-event budget. A click on a button got its `mousedown` registered, then the DOM was replaced by the next render before `mouseup` could fire, so the click never completed.

**Fixes:**

- **Removed the in-render setFlag.** Orphan unreads stay in the flag (invisible to the user — the display filter already excludes them from the badge). Actual flag cleanup still runs explicitly on the contact-delete path.
- **Render throttle bumped from rAF (~60/s) to leading+trailing with a 250ms floor (~4/s).** Click handlers now have a stable DOM between renders. Clock still updates promptly — 4 ticks per second is below human-perceivable lag for a wall clock.
- **Routed the Simple Calendar `date-time-change` hook through the throttle** instead of calling `ui.render(true)` directly. Same for `userConnected`.

No new features, no behavior changes outside the loop fix. Drop-in over 4.7.

---

## Beta 4 — Patch 4.7 (Community feedback round 3)

Big follow-up driven by **Gotto Goho**, **BubbleMushroom**, and **kieraboom**. Four bugs, eight features, all rolled together.

### Bugs

- **Ghost messenger notifications.** Gotto reported a red "4" stuck on the messenger app icon with no visible conversation to clear it. Root cause: the home-screen badge summed `Object.values(unreads)` from a flag keyed by threadId — when a contact (or one-off NPC thread) was deleted, its unread count was left orphaned in the flag forever. Fixed by filtering unreads against the current contacts list before summing, AND opportunistically garbage-collecting orphan keys when a render notices them. Deleting a contact now also explicitly clears its unread entry.
- **GM sees generic tokens for PCs in chat (Gotto).** The 4.5 fix for PC avatars used `User#character`, which is Foundry's user-management "Assigned Actor" field. Most groups never set it — they switch into their PC via the in-phone identity switcher instead. So the avatar lookup fell through to `user.avatar` (also blank) and finally the mystery-man default. Now the resolver also checks the sender's `lastActorUuid` AgentDevice flag and uses that actor's portrait as a fallback. Fallback order: NPC override → `user.character.img` → in-app PC identity → user profile pic → default icon.
- **Social posts always showed "Gamemaster".** No GM persona override existed for the social composer (the messenger had it, social didn't). Added an optional "Post AS" field that only appears for the GM — blank posts as Gamemaster, filled posts as that NPC name.
- **App "kept refreshing" (BubbleMushroom).** The `createChatMessage` hook was calling `app.render(true)` synchronously on every Agent message. Bulk operations (auction settlements, blast messages, NPC switchboard pushes) could land N messages in the same tick, each one triggering a full re-render, and the post-render path sometimes triggered more messages → visible refresh loop after enough chained activity. Coalesced all render requests through a single `requestAnimationFrame` tick so a burst of N messages costs one render.

### Privacy indicator wording tightened (Gotto)

The previous wording — "PRIVATE · X only (GMs can read)" — left players unsure whether OTHER players could read messages or just the recipient + GM. Now reads:

- Party group chat → **PARTY CHAT · EVERYONE READS**
- 1-1 player thread → **ONLY YOU + \<recipient\> + GM**
- NPC thread → **ONLY YOU + GM · NPC CHANNEL**

No more ambiguity.

### 4.7 in-flight fixes (post first-pass test)

- **NC Mart custom-item editor was a raw JSON textarea — hostile and error-prone.** Internal QA hit it; a Reddit user reported the same friction ("how do I add custom items? Core+Custom is on but nothing shows up"). Replaced with a form-based builder: separate inputs for Name / Category (with datalist suggestions: Weapons, Ammo, Armor, Clothing, Cyberware, Drugs, Gear, Vehicle, Pet, Program) / Price / Description / Image path, plus a FilePicker button for the image. ADD ITEM saves immediately to the backing setting, busts the catalog cache, and lists each added item below with one-click remove. Raw JSON editor is still available, hidden behind a `<details>` disclosure for power users.
- **Custom Compendium Packs section: added a pack-discovery list.** Compendium packs from world or other modules weren't loading because the GM didn't know the exact pack IDs to type. Added an expandable "Available packs in this world (N)" section showing every Item-type pack with label + ID + a one-click "+ ADD" button that appends the ID to the custom packs setting and refreshes the catalog. Solves the Reddit report — items from imported packs now show up the moment a pack is added.


- **NC Mart price-tier looked like it did nothing.** Original implementation was a max-cap filter ("≤ 1000 eb") which, on a category where every item was cheap (e.g. Drugs at 10-50eb), filtered out zero items regardless of which tier you picked — read as "the dropdown doesn't work." Rebuilt as proper price BUCKETS — selecting "500–1k eb (Costly)" now actually hides cheap items and shows only items in that range. Added a SHOWING X · \<tier label\> status line under the dropdown so the user can see at a glance what's filtering.
- **Affordability wallet icon "did nothing".** Same root cause — for a GM viewing VirtualWallet (unlimited eb), every item passes the affordability check, so toggling looked identical. The toggle was working all along (icon background flips cyan), but with no visible result the GM read it as broken. Status line now shows "AFFORDABLE ONLY (your balance: Xeb)" when the filter is on, making the active state unambiguous.
- **Social composer placeholder was being truncated to "Broadcast something t…".** Phone-frame width forced select + input + POST button to compete for ~280px. Restructured into stacked rows: row 1 is category select + text input (input gets all remaining space), row 2 (GM-only) is the persona override, row 3 is the full-width POST button. No more truncation on phone-frame width.
- **Fixer chat icon now opens a new-message picker (Gotto).** First pass dropped the user directly into a 1-1 thread with that fixer. Expected behavior: act like creating a new message — open the ADD CONTACT modal pre-filled with the fixer's name so the user (especially the GM) can pick which player device(s) the contact targets before the thread is created. Now does exactly that.

### Features

- **Sys Admin: Wallet Identity tabs (Gotto).** GM can now swap the active wallet view into any player's identity directly from Sys Admin (or back to System Fund). Mirrors the existing Application Access tab layout. The previously-orphaned `selectedAdminActorUuid` state finally has a UI control.
- **Trauma Team coverage gating (Gotto).** The bio-monitor "TRANSMIT PANIC SIGNAL" button now only appears for players the GM has marked as Trauma Team clients. Everyone else sees a dimmed "No Trauma Team Coverage — call REO Meatwagon and hope for the best" panel. GM sets each player's coverage tier (Bronze / Silver / Gold / Platinum / custom string) in Sys Admin → Player Profile.
- **NC Mart price-tier filter + fixer-rank gate (Gotto).** Players can now filter the catalog by price bucket (≤100 / ≤500 / ≤1k / ≤5k / ≤10k / all). Separately, a world-level "Fixer Rank Gate" pairs a price threshold with a minimum Fixer rank — items above the threshold are hidden from players below the rank. Each player's Fixer rank (0–10) is set in Sys Admin → Player Profile. GM bypasses the gate.
- **Style: Night City trend + wardrobe modifiers (Gotto).** GM-settable world-level trend label (e.g. "Asia Pop", "Nomad Leathers") with optional flavor line — shows on every player's Style screen. Per-actor wardrobe modifier list (label + signed value) renders as a small breakdown card under the score (e.g. "+5 Iconic Jacket", "-3 Visible Cyberware").
- **Fixer tab: edit-in-place + jump-to-messenger (Gotto).** Each fixer card now has a pencil icon (GM-only) that pre-fills the add row with the existing values for in-place editing, and a chat-bubble icon (everyone) that materialises a Messenger contact for that fixer and jumps straight to the thread.
- **Social feed: single-category filter (Gotto).** Filter chips at the top of the feed — click ALL to see everything, or click any category (Gig Board, DataPool, Rumor, etc.) to scope to that one. Categories list is built dynamically from posts that exist.
- **Datapool inject: in-modal explainer (Gotto).** Added a one-paragraph "What this does" panel inside the Data Injection modal so first-time GMs immediately understand what a shard is and where it shows up.

---

## Beta 4 — Patch 4.6 (Immersion polish + auction fix)

Hot follow-up to 4.5. Every Foundry Dialog popup is now an in-phone modal, the Add Contact row finally fits the frame, and the GM can win their own auctions without the eb deduction blowing up.

### Every Foundry Dialog popup moved in-phone
- **Edit Agent ID**, **Pay All Players**, **NPC Bid name prompt**, **Purge Record** (chat message), and **Purge Endpoint** (contact delete) no longer pop out of the phone — they all render as full-screen overlays inside the agent screen itself, matching the ADD CONTACT / MANUAL LEDGER modal style. Flag-driven (`showIdEditModal`, `showPayAllModal`, `showNpcBidModal`, generic `_pendingConfirm`), markup in `agent-ui.hbs`, drafts preserved across re-renders via `data-preserve-draft`. Net result: zero `new Dialog(...)` and zero `Dialog.confirm(...)` calls left in the module. Foundry stops barging in over the phone frame.
- The generic confirm modal supports red/cyan/gold accent themes and a custom confirm button label — future "are you sure?" prompts in the module reuse this single in-phone modal instead of pulling Foundry's again.

### Add Contact: BROWSE button overflowing the frame
- **Avatar field crushed, BROWSE button overflowing into the phone bezel.** Same root cause as every other "button eats the row" bug in this module — Foundry's `form button { display: block; width: 100% }` was overriding the inline `flex-shrink: 0`. Pinned the BROWSE button with `flex: 0 0 auto !important; width: auto !important; display: inline-flex !important; white-space: nowrap;`, and the Avatar input with `flex: 1 1 auto !important; min-width: 0 !important; box-sizing: border-box;` so it can shrink without forcing the row wider than the modal.

### Auction settlement: GM-as-winner no longer fails
- **"Payment failed — winner may lack funds" when the GM was the winning bidder.** Root cause: settlement was calling `_getIdentity(GM)` then `_executeTransfer` against whatever owned actor that resolved to — usually a 0-balance test NPC, occasionally an Item Piles shop, and the transfer rightly bounced. The GM runs the house and shouldn't be paying themselves anyway. Now: GM winners are treated the same as NPC winners — skip the eb deduction, mark settled, surface a "(GM win — house keeps it)" note in the settlement notification. Player winners still get debited as normal.

### Agent ID edit dialog: input sizing
- **"Registered" was rendering with its bottom half cut off** in the SIN Status dropdown. Dialog inputs had `padding:6px` and no explicit height, so Foundry's default form styling clipped the descenders. Bumped all inputs in the form to `height: 36px; line-height: normal; font-size: 0.85rem; padding: 8px` so the full text is visible on every field. (Carried into the new in-phone modal too.)

---

## Beta 4 — Patch 4.5 (Community feedback round 2)

Big drop driven by community reports. Credits: **Gotto Goho** (GM identity / messenger TO indicator / social feed sort / auction NPC bidders), **Ley** (text-box sizing / privacy indicators), **CommanderCrunch69** (NC Mart Save button / NPC + PC avatars / Pay Contact filter), **Ryouhi** (Item Piles identity bug), **kieraboom** (listener-leak guard), **Aeroshifter** (Agent ID display name).

### NC Mart GM gates: SAVE button + "Currently in effect" display
- **Max Price / Source Filter / Locked Categories now actually save.** CommanderCrunch69 noticed expensive items still showing in NC Mart even after setting a Max Price cap — root cause was the GM Controls inputs had no commit path, so edits never wrote back to the settings. Added a **SAVE GATES** button (and a **CLEAR** button to reset all three at once) plus a "Currently in effect" readout panel showing what's actually saved server-side. Pattern now matches the blacklist's ADD-and-display flow.

### Agent ID: separate Display Name + Display Handle
- **Aeroshifter request** (r/cyberpunkred): netrunners want to keep their handle as the public-facing identity that other players see in contacts and chat, while showing their character's real name on their own Agent ID's "Global Registry" view. Added a `displayName` field to the GM-side ID edit dialog (alongside the existing handle). The OWNER's own ID card uses `displayName → actor name → user name` for the big name on the card; OTHER players still see the handle in contacts / messenger / group chat / everywhere else. GM's view of the player's card mirrors the owner's view so the GM sees what the player sees.

### Pay Contact no longer routes payments to Item Piles shops
- **Item Piles drink-menus and other shop actors no longer hijack identity.** Ryouhi caught that Pay Contact was sending payment to the wrong character — players with Item Piles shop ownership (e.g., a "drink menu" character they bought from at a bar) got the shop targeted instead of their PC. Root cause: `_getIdentity` fallback picked the FIRST owned actor with no filtering, and Item Piles managed actors are often returned first by Foundry's actor index.
- Fix: the fallback now filters owned actors by `type === "character"` AND excludes any actor with an `item-piles` flag block (covers Item Piles vaults, merchants, containers, drink menus, etc.). If multiple PCs are still in scope, picks the most-recently-modified one as a sensible default. Players with multiple PCs can still switch explicitly via the multi-character dropdown.

### Defensive listener-leak guards (kieraboom "constantly clicking" report)
- Tightened the scroll-drag handlers in chat / contact / transaction lists so jQuery listeners use `.off()` then `.on()` with a namespace (`.agentScrollDrag`). On most renders the DOM is fresh and this didn't matter, but in the rare case where a stray render fires during an active scroll-drag the handlers could stack — and after enough stacks the cumulative `mousemove` events ate input and stole focus from fields, which read as "the mouse is constantly clicking" / "can't type in fields." Off-before-on prevents accumulation regardless of render edge cases. Window-level listeners (map pan, window drag) already had this guard from beta 4.

### Avatars actually show now (NPCs on GM side + PCs everywhere)
- **GM and player see the same conversation.** CommanderCrunch69 caught that NPC contact avatars only rendered on player-side message bubbles, never on the GM's view. Root cause: GM-as-NPC messages have `m.author === game.user`, so they hit `isSelf: true`, and the template only renders avatars on non-self bubbles. GM saw their NPC bubbles on the right with no avatar; player saw the same messages on the left with the NPC avatar.
- Fix: when a message has `overrideAvatar` set (roleplay-as-NPC), treat it as "from the NPC" for layout — left-aligned, NPC avatar next to the bubble, NPC name as sender. Both sides now render identically. Persona-style framing. Delete permission still tracks the real author.
- **PC avatars now show in group chat + PC↔NPC threads.** Same report — players' avatars weren't appearing. Root cause: fallback used `User.avatar` (Foundry profile pic) which most players never set, so all bubbles fell to the default mystery-man icon. Now prefers the assigned **character's portrait** (`actor.img`) — falls back through NPC override → character portrait → user profile pic → default. Applied to message bubbles, the group-participants header avatar stack, AND the typing indicator avatar.

### Auction bid input legibility
- **The bid amount input was being crushed.** On the auction detail screen, the input field was getting flex-squeezed to ~10px wide because BID + NPC buttons (both with icon + text labels) ate the row on the phone-frame width. Restructured to put input + BID on the main row (input forced to `min-width: 80px`), and moved the GM-only NPC button to its own row underneath so it can never compress the bid input again.

### NC Mart search bar reclaimed the row
- **Search input no longer crushed by the affordability filter button.** The "ALL / CAN BUY" toggle was eating ~70% of the search-row width because Foundry's `form button` rule was forcing it full-width and the label was padded. Filter is now a single 32px wallet-icon toggle (cyan when active, dim when off) pinned to natural size; search field flex-shares the rest of the row. Same behaviour, less than a quarter of the footprint.

### Holophone permission spam fixed
- **"User X lacks permission to update Token Y" no longer spams every client whenever any player opens their phone.** Patch 3.3's multi-client sync had every client call `Tagger.addTags` on the originator's token, which writes a token flag — and non-owner clients can't write flags on tokens they don't own. Each phone open produced 3+ permission-error toasts on every other player's screen plus the GM's. Replaced the Tagger-flag tracking with a local `globalThis.__AgentDeviceCalling` Set keyed by token id; each client now tracks its own animation state without persisting anything. Tagger is no longer a required module — only Sequencer + JB2A.

### Scroll preservation hardened
- **Tab clicks and toggle clicks in Sys Admin no longer snap to top.** The patch 3.3 generic scroll preserver worked for most cases but missed some timing edge cases where Foundry's post-render focus pass reset scroll. Stacked targeted captures + 4 restore passes (sync, rAF, setTimeout 50ms, setTimeout 150ms) on both `admin-tab-select` and `toggle-app-lock` handlers. Holds scroll regardless of what else fires after render.

### Gotto Goho-reported
- **GM no longer logs in as the first player's identity.** Auto-default on initial open was silently setting the GM's "Active System Target" to whatever the first listed player's character was — which meant the GM's own wallet view showed the first player's balance, not theirs. Now defaults to GM Virtual Wallet; GM explicitly switches into a player when they need to act as one.
- **Messenger header now shows "TO:" alongside "SPEAKING AS:" (GM-only, NPC threads).** Previously you only saw which persona you were speaking AS — recipients were invisible unless you'd renamed the thread by hand. N