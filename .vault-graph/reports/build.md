# Build report — Vault Graph du dépôt `prettozm/vaultgraph`

| Champ | Valeur |
|---|---|
| Mode | INIT (premier run, `state.json` vide) |
| Horodatage (`generated_at`) | 2026-09-03T19:49:52Z (révision 3 : republication sur prettozm/vaultgraph ; révision 2 2026-09-02T22:09:24Z ; run moteur initial 2026-09-02T21:37:03Z) |
| Commit source | `6abf2e52444f65d7b9bc8df0fe21c08a2519659f` (branche `main`) |
| Générateur | agent `claude` |
| Corpus scanné | `fixtures/demo-vault/**/*.md` — 13 fichiers |
| Delta | NEW 13 · MODIFIED 0 · DELETED 0 |
| Schéma | `schema.yaml` inchangé par rapport au template (aucun type/relation ajouté) |

> Note d'honnêteté : le moteur a été interrompu (redémarrage du conteneur) après l'écriture
> du graphe et de `state.json` mais avant la rédaction des rapports. Ce rapport a été rédigé
> par l'agent principal **à partir des données produites** (`graph/*.jsonl`, `graph.json`,
> `state.json`), sans regénération. Le validateur `scripts/validate-vault.mjs` a été rejoué
> sur ces données après coup (résultat ci-dessous).

## Fichiers scannés (13)

`fixtures/demo-vault/` : `README.md`, `glossaire.md`, `contexte/projet-lumen.md`,
`besoins/utilisateurs.md`, `cas-usage/scenarios.md`, `electronique/alimentation-led.md`,
`electronique/thermique.md`, `finance/prix-et-marche.md`, `decisions/ADR-001-batterie.md`,
`decisions/ADR-002-prix-de-lancement.md`, `notes/2026-08-changement-batterie.md`,
`notes/idee-isolee.md`, `hypotheses/hypotheses-ouvertes.md`.
Chaque fichier a son empreinte sha256 dans `state/state.json` ; chacun est cité par au
moins une provenance (13/13 fichiers couverts, 100 % des provenances avec plage de lignes).

## Résultat

| | Total |
|---|---|
| Nœuds | 39 |
| Arêtes | 64 |
| Orphelins (degré 0) | 1 — motivé (`reason`), voir `unresolved.md` |
| Candidats | 5 arêtes, voir `candidates.md` |
| Rejetés | 0 (`rejected` est réservé au sens épistémique, cf. révision 2) |

### Nœuds par type
concept 17 · besoin 4 · cas_usage 4 · decision 3 · fonctionnalite 3 · hypothese 3 · source 3 · contexte 2

### Arêtes par relation
related_to 21 · aborde 17 · fonde 11 · derive_de 6 · exprime 2 · contredit 2 · precede 2 · legitime 1 · raffine 1 · supersede 1

### Contextes
electronique 12 · produit 10 · finance 5 · hypotheses 4 · projet 4 · decision 3 · hors-sujet 1

### États épistémiques (nœuds + arêtes)
explicit 98 · candidate 5 · rejected 0

## Choix de modélisation notables

- **Homonymie** (CDC §13) : `concept:resistance-electronique` (contexte `electronique`) et
  `concept:resistance-finance` (contexte `finance`) sont deux nœuds distincts ; aucune fusion.
- **Contradiction / supersession** : `decision:revision-batterie-li-ion-nmc` →
  `decision:adr-001-batterie-lifepo4` porte à la fois `contredit` (edge:0049) et `supersede`
  (edge:0050), la note source employant explicitement les deux formulations.
- **Hypothèses** : les trois nœuds `hypothese:*` gardent le statut `explicit` (elles sont
  explicitement énoncées comme hypothèses dans la source) et ne sont jamais `confirmed`.
- **Orphelin** : `source:note-idee-isolee` n'est rattaché à rien ; `reason` explicite.
- **Nœuds `source`** : créés uniquement pour les documents sans objet de connaissance propre
  (README du vault, glossaire, note isolée) ; les autres documents sont représentés par
  leurs objets.

## Checklist de validation (rejouée : `node scripts/validate-vault.mjs .vault-graph`)

- [x] Structure des 11 fichiers présente ; JSON / JSONL / YAML bien formés
- [x] Identifiants uniques (nœuds, arêtes) et conformes au motif `type:slug`
- [x] Types, relations, statuts ∈ `schema.yaml`
- [x] Aucune arête pendante
- [x] Tout nœud/arête sans provenance est `candidate`/`unresolved` (aucun cas ici)
- [x] Tout orphelin porte un `reason`
- [x] Tous les `sources[].file` existent dans le dépôt
- [x] `manifest.generated_at` = `graph.generated_at` ; `manifest.source.commit` = `graph.source_commit`
- [x] `graph.counts` et `by_*` égaux aux décomptes réels
- [x] `state.files` : 13 empreintes sha256 valides

Résultat : **OK, 0 avertissement.**

## Révision 2 — corrections après passe contrarian (2026-09-02T22:09:24Z)

Un relecteur adversarial indépendant (lecture seule) a relu **toutes** les citations des 28 arêtes à relation
forte. Aucun invariant mécanique n'était violé ; cinq corrections sémantiques ont été appliquées aux
données, puis `graph.json` a été recalculé par `scripts/rebuild-graph-summary.mjs --touch` :

| Élément | Avant | Après | Motif |
|---|---|---|---|
| `edge:0058` hypothese:acceptation-du-prix → adr-002 | `fonde` explicit | `fonde` **candidate** | la source ADR-002 (L33-38) parle d'une hypothèse « 45 € », celle du fichier hypothèses (L10-17) d'un prix « > 60 € » : deux propositions ; le lien « conditionne en partie » (L15-17) ne justifie pas un `fonde` explicite |
| `edge:0016` besoin:robustesse-thermique → bilan-thermique-boitier | `fonde` explicit | `related_to` **candidate** | la citation (L21-27) renvoie au document `thermique.md`, ne nomme pas le concept |
| `edge:0022` cas_usage:achat-boutique-locale → resistance-finance | `exprime` | `related_to` | la source dit « directement lié à » |
| `edge:0062` hypothese:generalisation-taux-de-panne → besoin:robustesse-thermique | `derive_de` explicit | `derive_de` **candidate** | simple renvoi de fichier « évoqué de façon informelle », même qualité de preuve que `edge:0063` déjà candidate |
| `concept:regulateur-a-decoupage` | `rejected` | `explicit` | `rejected` désigne un état épistémique (nœud réfuté/supplanté), pas une alternative produit non retenue ; le concept est explicitement documenté (L29-34) |

Règle explicitée à cette occasion : `edge:0047` (`precede` entre ADR-001 et ADR-002) est **conservée
`explicit`** — la précédence est déterminée mécaniquement par les dates de statut des deux ADR (L3-6 et
L3-5), donc observable, non inférée. Contrat de format précisé dans INSTRUCTIONS.md §11 : `by_status`
compte nœuds **et** arêtes. `manifest.source.commit` reste `6abf2e5…` : c'est le commit du **vault
source**, inchangé depuis (`git diff 6abf2e5 HEAD -- fixtures/` vide).
