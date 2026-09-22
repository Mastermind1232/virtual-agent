# Virtual Agent (GitHub packaging)

Virtual Agent is a Foundry VTT v12 module for Cyberpunk RED by **inGramGames**: an in-character smartphone for players (Messenger, Data Pool, Wallet, Sat Map, Biomon, NC Mart, and more).

The module is written and maintained by inGramGames and released on their Patreon: https://www.patreon.com/inGramGames. This repository only repackages each release with a Foundry manifest so it can be installed and updated from Foundry's module manager. Changes from the author's zip: the manifest, download, url and authors fields of `module.json`, one fix in `scripts/main.js` so apps a GM switched off in Application Access stay off across reloads (the startup migration now respects the GM's saved list), a "Party" tab in Application Access that toggles an app on every player's phone at once (the GM's own phone is separate), a "Sat Map scene" setting that puts that Foundry scene's map pins on the phone and shows a party blip at the active scene's spot, and Agent ID player tabs that no longer overlap.

Permission to host it this way was given by the author (mexisol187) on Reddit on 2026-09-22: "Everything I make for this is open source for what you want!" Please support the original developer on Patreon, and report bugs to them there or on Reddit.

## Install

Foundry, Add-on Modules, Install Module, paste this manifest URL:

```
https://raw.githubusercontent.com/Mastermind1232/virtual-agent/main/module.json
```

Later releases arrive through Foundry's Update button.

## Version

Current packaging: Virtual Agent 1.8.4 (released by inGramGames on 2026-07-16), packaged as 1.8.4.6. For this campaign the NCPD DB app is labelled AGPD DB and the Fixers app is labelled Contacts.
