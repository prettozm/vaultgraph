# INSTRUCTIONS — Vault Graph 0.1

Tu es l'agent qui produit `.vault-graph/`. **Ce fichier est le contrat complet : il se suffit à lui-même.**
Aucun runtime, aucune base, aucun service n'est requis.

Deux déclencheurs suffisent :

- « Lis `.vault-graph/INSTRUCTIONS.md` et initialise le Vault Graph. » → mode **INIT**
- « Lis `.vault-graph/INSTRUCTIONS.md` et mets à jour le Vault Graph. » → mode **UPDATE**

Tu détermines le mode toi-même (§3), quelle que soit la formulation employée.

---

## 1. Objet

`.vault-graph/` expose une **projection graphe contextualisée, traçable et reconstructible** du contenu
documentaire du dépôt. Le dépôt possède son état ; le moteur (toi) et le viewer sont remplaçables.
Git fournit l'historique, `.vault-graph` fournit le contrat.

Arborescence obligatoire — ne rien ajouter, ne rien retirer :

```text
.vault-graph/
├── manifest.json
├── config.yaml
├── schema.yaml
├── INSTRUCTIONS.md
├── graph/
│   ├── graph.json
│   ├── nodes.jsonl
│   └── edges.jsonl
├── state/
│   └── state.json
└── reports/
    ├── build.md
    ├── candidates.md
    └── unresolved.md
```

`graph/graph.json` n'est qu'un **résumé/projection** : la donnée vit dans les deux `.jsonl`
(un objet JSON par ligne ; un fichier vide est valide).

---

## 2. Invariants

Vérifiables mécaniquement. Tu dois pouvoir les contrôler à la main, sans outil.

1. **Ids uniques** — aucun id de nœud en double, aucun id d'arête en double.
2. **Intégrité référentielle** — pour chaque arête, `from` et `to` référencent un id de nœud existant.
3. **Provenance** — tout nœud ou arête dont `sources` est vide **doit** avoir `status` = `candidate` ou `unresolved`.
4. **Zéro orphelin inexpliqué** — tout nœud de degré 0 (aucune arête entrante ni sortante) **doit** porter un `reason` non vide.
5. **Complétude du manifeste** — tout fichier référencé par `manifest.json` existe.
6. **Cohérence de fraîcheur** — `manifest.generated_at` == `graph.json.generated_at` et `manifest.source.commit` == `graph.json.source_commit`.
7. **Vocabulaire** — `type` ∈ `schema.yaml:nodes`, `relation` ∈ `schema.yaml:relations`, `status` ∈ `schema.yaml:epistemic_states`.
8. **Id de nœud** — `"<type>:<slug>"`, slug en ascii minuscule `a-z0-9` et tirets uniquement.
9. **Id d'arête** — `"edge:0001"`, séquence numérique zéro-paddée sur 4 chiffres au minimum ; **les ids existants sont préservés** d'un run à l'autre.
10. **Bonne formation** — tous les `.json` sont du JSON valide ; `nodes.jsonl` / `edges.jsonl` contiennent un objet JSON complet par ligne, sans virgule de séparation.

---

## 3. Modèles

Nœud (`graph/nodes.jsonl`) :

```json
{
  "id": "concept:memoire-activable",
  "type": "concept",
  "label": "mémoire activable",
  "context": "core",
  "status": "explicit",
  "sources": [
    { "file": "docs/memory.md", "heading": "Mémoire activable", "line_start": 14, "line_end": 22 }
  ]
}
```

Champs optionnels : `reason` (obligatoire si degré 0), `aliases` (tableau de chaînes).

Arête (`graph/edges.jsonl`) :

```json
{
  "id": "edge:0001",
  "from": "fonctionnalite:projection",
  "to": "concept:memoire-activable",
  "relation": "aborde",
  "status": "explicit",
  "sources": [ { "file": "docs/strategy.md", "line_start": 38, "line_end": 42 } ]
}
```

---

## 4. Modes et détection

- **INIT** si `state/state.json` est absent, ou si son `files` est vide, ou si `nodes.jsonl` et `edges.jsonl` sont tous deux vides.
- **UPDATE** sinon.

Un **rescan complet** (relecture de tous les fichiers retenus, mais **ids existants conservés**) est
obligatoire quand `state/state.json` manque, ou quand `schema.yaml` ou `config.yaml` ont changé depuis
le dernier run. Dans tous les autres cas, traite **uniquement le delta**.

---

## 5. Scan et delta

1. Applique les globs `scan.include` puis `scan.exclude` de `config.yaml`, sur des chemins
   **relatifs à la racine du dépôt**, séparateur `/`. `exclude` l'emporte toujours.
2. Calcule le **sha256** (hex minuscule) du contenu de chaque fichier retenu — p. ex. `sha256sum <fichier>`.
3. Compare à `state/state.json:files` :
   - **NEW** — présent maintenant, absent de l'état ;
   - **MODIFIED** — présent des deux côtés, `sha256` différent ;
   - **DELETED** — présent dans l'état, absent maintenant ;
   - *inchangé* — même `sha256` : **ne pas relire**.
4. En UPDATE, ne traite que **NEW / MODIFIED / DELETED**. Ne relis pas tout le vault « par sécurité ».

---

## 6. Extraction

- Identifie les objets qui correspondent aux types de `schema.yaml:nodes`. Tu peux **proposer** un type
  ou une relation manquante : ajoute-le à `schema.yaml` et signale-le dans `reports/build.md`.
- **Chaque nœud et chaque arête porte sa provenance** : `file`, et si possible `heading`,
  `line_start`, `line_end`.
- **N'invente jamais une provenance.** Sans provenance vérifiable, le statut est `candidate`
  (tu penses que l'objet existe mais tu ne peux pas le sourcer) ou `unresolved` (tu ne peux pas trancher).
- `context` sépare les domaines du vault (p. ex. `core`, `produit`, `electronique`). Il est obligatoire.

---

## 7. Réconciliation

Avant toute création, cherche l'antériorité :

```text
candidat
   ↓
recherche dans les nœuds existants (label, context, aliases)
   ↓
 ┌───────────────┬────────────────────┬──────────────┐
 match sûr        ambigu               aucun match
 ↓                ↓                    ↓
 pointer vers     créer en `candidate` créer
 l'existant       + reports/candidates.md
```

**Même label ≠ même concept.** Deux homonymes reçoivent des slugs distincts **et** des `context` distincts :

```text
concept:resistance-electronique   context: electronique
concept:resistance-finance        context: finance
```

La « résistance » de l'électronique et la « résistance » de la finance doivent pouvoir coexister
sans jamais être fusionnées. En cas de doute : `candidate`, jamais une fusion silencieuse.

---

## 8. Orphelins

Un graphe totalement connecté n'est pas un objectif. Les orphelins sont **autorisés**.
Invariant : *zéro orphelin inexpliqué*. Tout nœud de degré 0 porte un `reason` explicite,
p. ex. `"reason": "no justified relation found"`, et est listé dans `reports/unresolved.md`.
**Ne force jamais la connectivité** pour faire joli.

---

## 9. Contradictions, supersession, hypothèses

- Deux affirmations sourcées qui s'opposent → une arête `contredit` entre elles. Ne choisis pas de camp.
- Un élément qui en remplace un autre → une arête `supersede` (du nouveau vers l'ancien).
  L'ancien nœud est **conservé**, éventuellement passé en `rejected`.
- Une hypothèse reste un nœud de type `hypothese`. Elle n'est **jamais** promue en fait,
  quel que soit le nombre de documents qui la répètent.

---

## 10. Fichiers DELETED

Pour chaque nœud ou arête dont **toutes** les sources ont disparu :

- soit tu le **supprimes** de `nodes.jsonl` / `edges.jsonl` (et tu supprimes alors les arêtes qui le référencent, sinon l'invariant 2 casse) ;
- soit tu le passes en `unresolved` avec un `reason` (p. ex. `"source file removed at <commit>"`).

Dans les deux cas, consigne-le dans `reports/unresolved.md`. Un nœud qui garde au moins une source valide n'est pas concerné.

---

## 11. Écriture

Tu écris **uniquement à l'intérieur de `.vault-graph/`** (`config.yaml:write_scope`).
Tu ne modifies **aucun document source**, jamais.

À la fin du run :

1. Réécris `graph/nodes.jsonl` et `graph/edges.jsonl` (un objet par ligne).
2. Recalcule `graph/graph.json` à partir des JSONL :
   `counts.nodes`, `counts.edges`, et les histogrammes `by_type`, `by_relation`, `by_context`, `by_status`.
   Populations : `by_type` et `by_context` comptent les **nœuds** ; `by_relation` compte les **arêtes** ;
   `by_status` compte **nœuds et arêtes confondus** (sa somme vaut `counts.nodes + counts.edges`).
3. Mets à jour `state/state.json` avec **tous** les fichiers scannés (pas seulement le delta) :
   `{ "last_run": "<ISO-8601 UTC>", "source_commit": "<sha>", "files": { "<chemin>": { "sha256": "<hex>" } } }`.
   Les entrées des fichiers DELETED disparaissent.
4. Mets à jour `manifest.json` : `generated_at` = maintenant en UTC ISO-8601 (`2026-09-02T22:00:00Z`),
   `source.commit` = `git rev-parse HEAD`, `source.branch` = la branche si tu la connais,
   `generator.name` = ton propre nom d'agent.
5. Reporte les mêmes `generated_at` et `source_commit` dans `graph/graph.json` (invariant 6).

---

## 12. Rapports

- `reports/build.md` — mode (INIT/UPDATE), horodatage, commit, nombre de fichiers NEW / MODIFIED / DELETED,
  nombre de nœuds et d'arêtes créés / mis à jour / supprimés, types ou relations ajoutés au schéma,
  et le **résultat de la checklist §13** (chaque invariant : OK / KO).
- `reports/candidates.md` — chaque `candidate` : id, label, **pourquoi** il est candidat
  (provenance manquante, homonymie, match ambigu) et ses sources.
- `reports/unresolved.md` — chaque orphelin et chaque `unresolved` : id, `reason`, sources restantes.

Ces rapports remplacent les placeholders « No run yet. » du template.

---

## 13. Checklist de validation

À exécuter **avant** d'annoncer que c'est fait :

- [ ] tous les `.json` parsent ; chaque ligne des `.jsonl` parse ;
- [ ] invariant 1 — ids uniques ;
- [ ] invariant 2 — chaque `from`/`to` pointe vers un nœud existant ;
- [ ] invariant 3 — `sources` vide ⇒ `status` `candidate` ou `unresolved` ;
- [ ] invariant 4 — tout nœud de degré 0 a un `reason` non vide ;
- [ ] invariant 5 — tous les fichiers du manifeste existent ;
- [ ] invariant 6 — `generated_at` et `source_commit` cohérents entre manifeste et `graph.json` ;
- [ ] invariant 7 — `type`, `relation`, `status` appartiennent au `schema.yaml` ;
- [ ] invariants 8-9 — formes d'id respectées, ids préexistants préservés ;
- [ ] `graph.json.counts` correspond au nombre réel de lignes des JSONL.

Si le dépôt contient `scripts/validate-vault.mjs`, exécute en complément :

```bash
node scripts/validate-vault.mjs .vault-graph
```

Son absence n'est pas une excuse : la checklist ci-dessus reste obligatoire.

---

## 14. Fraîcheur

Le viewer affiche `generated_at` (date de génération du graphe), distincte de la date de
téléchargement de la page. Un graphe périmé **doit rester visible comme périmé** : c'est voulu.
Ne falsifie jamais `generated_at`, et ne le mets à jour que lors d'un run réel.

---

## 15. Interdits

Tu ne dois pas :

- modifier les documents source ;
- écrire hors de `.vault-graph/` ;
- inventer une provenance ;
- fusionner silencieusement deux nœuds ;
- forcer la connectivité ;
- transformer une hypothèse en fait ;
- réécrire des ids existants.

**Ce que le protocole n'est pas** : ni base de données, ni Neo4j/RDF/OWL/SPARQL, ni RAG, ni moteur
vectoriel, ni backend, ni authentification, ni SaaS, ni éditeur documentaire, ni orchestrateur agentique —
seulement un dossier de fichiers plats versionnés par Git.
