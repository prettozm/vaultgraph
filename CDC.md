# CDC — Vault Graph v0.1

## 1. Objectif

Construire une preuve de concept générique permettant de rendre **n’importe quel dépôt documentaire Git compatible avec une représentation graphe**, sans imposer de moteur, de base de données ou d'application dans le dépôt cible.

Le système repose sur trois éléments indépendants :

```text
REPO UTILISATEUR
     │
     └── .vault-graph/
              │
              │ contrat + état dérivé
              ▼
       UNIVERSAL VIEWER
              │
              ▼
       graphe explorable
```

Un agent IA peut créer ou mettre à jour `.vault-graph/`.

La webapp universelle ne construit pas le graphe.

Elle **lit et projette** un graphe déjà produit.

---

## 2. Expérience utilisateur cible

### Installation — méthode A

L'utilisateur télécharge :

```text
vault-graph-bootstrap.zip
```

et l'extrait à la racine de son dépôt.

Résultat :

```text
mon-repo/
├── ...
└── .vault-graph/
```

Puis il demande à son agent :

> Lis `.vault-graph/INSTRUCTIONS.md` et initialise le Vault Graph de ce dépôt.

### Installation — méthode B

L'utilisateur n'installe rien manuellement.

Il transmet simplement à Claude :

```text
Installe et initialise Vault Graph sur ce dépôt :

https://github.com/owner/repository
```

avec le contrat/prompt fourni par le projet.

Claude :

1. accède au dépôt ;
2. crée `.vault-graph/` ;
3. analyse le vault ;
4. génère le graphe ;
5. génère les rapports ;
6. vérifie le résultat.

---

## 3. Usage courant

Une fois installé :

> Mets à jour le Vault Graph.

doit suffire.

L'agent lit :

```text
.vault-graph/INSTRUCTIONS.md
```

et sait :

- quoi scanner ;
- quoi ignorer ;
- quels fichiers ont changé ;
- quel schéma utiliser ;
- où écrire ;
- comment réconcilier ;
- comment représenter l'incertitude ;
- comment valider le résultat.

---

## 4. Structure cible dans un dépôt

```text
.vault-graph/
├── manifest.json
├── config.yaml
├── schema.yaml
├── INSTRUCTIONS.md
│
├── graph/
│   ├── graph.json
│   ├── nodes.jsonl
│   └── edges.jsonl
│
├── state/
│   └── state.json
│
└── reports/
    ├── build.md
    ├── candidates.md
    └── unresolved.md
```

Aucune autre installation ne doit être obligatoire dans le dépôt cible.

En particulier :

- pas de `node_modules` ;
- pas de serveur ;
- pas de base de données ;
- pas de runtime obligatoire ;
- pas de dépendance au viewer ;
- pas de dépendance obligatoire à Claude.

---

## 5. Principe architectural

`.vault-graph` est un **protocole embarqué**.

Il contient :

```text
CONTRAT
+
CONFIGURATION
+
ÉTAT
+
PROJECTION
```

Il ne contient pas nécessairement le moteur qui produit cet état.

---

## 6. `manifest.json`

C'est le point d'entrée universel.

Exemple :

```json
{
  "format": "vault-graph",
  "version": "0.1",
  "graph": "graph/graph.json",
  "nodes": "graph/nodes.jsonl",
  "edges": "graph/edges.jsonl",
  "config": "config.yaml",
  "schema": "schema.yaml",
  "generated_at": "2026-09-02T22:00:00Z",
  "source": {
    "type": "git",
    "commit": "abc123"
  },
  "generator": {
    "type": "agent",
    "name": "claude"
  }
}
```

Le viewer doit pouvoir fonctionner à partir de ce fichier uniquement.

---

## 7. Date de fraîcheur

Le viewer doit afficher clairement :

```text
Dernière génération du graphe
02/09/2026 22:00

Commit source
abc123
```

Il faut distinguer :

```text
graph.generated_at
```

de :

```text
viewer.fetched_at
```

La date importante pour l'utilisateur est **la date de génération du graphe**, pas la date à laquelle la page Web l'a téléchargé.

---

## 8. `config.yaml`

Décrit ce que le repo considère comme son vault.

Exemple :

```yaml
scan:
  include:
    - "**/*.md"
    - "**/*.yaml"
    - "**/*.json"
    - "**/*.jsonl"

  exclude:
    - ".git/**"
    - ".vault-graph/**"
    - "node_modules/**"
    - "generated/**"

reconciliation:
  context_first: true
  allow_orphans: true
  uncertain_match:
    action: candidate

write_scope:
  - ".vault-graph/**"
```

---

## 9. `schema.yaml`

Décrit la grammaire locale du vault.

Exemple :

```yaml
nodes:
  - source
  - concept
  - besoin
  - cas_usage
  - fonctionnalite
  - decision
  - hypothese
  - contexte

relations:
  - aborde
  - exprime
  - fonde
  - legitime
  - precede
  - raffine
  - supersede
  - contredit
  - derive_de
  - related_to

epistemic_states:
  - explicit
  - candidate
  - confirmed
  - unresolved
  - rejected
```

Un autre vault peut avoir un schéma complètement différent.

Le viewer ne doit pas connaître ces types à l'avance.

---

## 10. Modèle de nœud

Minimum :

```json
{
  "id": "concept:memory-activable",
  "type": "concept",
  "label": "mémoire activable",
  "context": "core",
  "status": "explicit",
  "sources": [
    {
      "file": "docs/memory.md",
      "heading": "Mémoire activable",
      "line_start": 14,
      "line_end": 22
    }
  ]
}
```

---

## 11. Modèle de relation

```json
{
  "id": "edge:123",
  "from": "feature:projection",
  "to": "concept:memory",
  "relation": "aborde",
  "status": "explicit",
  "sources": [
    {
      "file": "docs/strategy.md",
      "line_start": 38,
      "line_end": 42
    }
  ]
}
```

---

## 12. Provenance

Invariant :

> Toute connaissance durable doit pouvoir revenir à une source.

Un nœud ou une relation sans provenance doit être :

```text
candidate
```

ou :

```text
unresolved
```

sauf justification explicite.

---

## 13. Réconciliation

Avant création :

```text
candidate
    ↓
recherche existant
    ↓

┌─────────────┬──────────────┬───────────────┐
│             │              │
match sûr   ambigu        aucun match
│             │              │
pointer     candidate       créer
```

Même label ≠ même concept.

Exemple obligatoire :

```text
résistance / électronique
```

et :

```text
résistance / finance
```

doivent pouvoir coexister.

---

## 14. Orphelins

Un graphe totalement connecté n'est pas un objectif.

Invariant :

> zéro orphelin inexpliqué.

Un nœud peut être :

```json
{
  "status": "unresolved",
  "reason": "no justified relation found"
}
```

---

## 15. Construction du graphe

Dans la v0, Claude peut être le moteur.

Il peut :

- lire les fichiers ;
- identifier les objets ;
- proposer des types ;
- proposer des relations ;
- chercher les antériorités ;
- détecter des contradictions ;
- générer `.vault-graph`.

Il ne doit pas :

- modifier les documents source ;
- inventer une provenance ;
- fusionner silencieusement ;
- forcer la connectivité ;
- transformer une hypothèse en fait.

---

## 16. Delta et mise à jour

`state/state.json` doit permettre de connaître l'état du dernier run.

Minimum :

```json
{
  "last_run": "2026-09-02T22:00:00Z",
  "source_commit": "abc123",
  "files": {
    "docs/a.md": {
      "sha256": "..."
    },
    "docs/b.md": {
      "sha256": "..."
    }
  }
}
```

Lors d'une mise à jour, l'agent doit préférer :

```text
NEW
MODIFIED
DELETED
```

à une relecture complète si cela est possible.

---

## 17. Viewer universel

Le même repo produit également une application Web indépendante.

Elle doit être publiée automatiquement sur GitHub Pages.

Par exemple :

```text
https://owner.github.io/vault-graph/
```

---

## 18. Écran d'accueil

L'application affiche simplement :

```text
VAULT GRAPH

GitHub repository

[ https://github.com/................. ]

             [ Load graph ]
```

---

## 19. Chargement d'un dépôt

Pour la v0 :

**dépôts GitHub publics uniquement.**

À partir de :

```text
https://github.com/foo/bar
```

le viewer recherche :

```text
https://raw.githubusercontent.com/foo/bar/<branch>/.vault-graph/manifest.json
```

ou utilise l'API GitHub appropriée.

Il ne doit pas supposer que la branche principale s'appelle `main`.

Il doit la déterminer.

---

## 20. Cas repo incompatible

Si :

```text
.vault-graph/manifest.json
```

n'existe pas :

afficher :

```text
This repository does not expose a Vault Graph.
```

Puis proposer les deux méthodes d'installation :

```text
Download bootstrap ZIP
```

ou :

```text
Copy Claude install prompt
```

---

## 21. Vue principale

Après chargement :

```text
Repository
foo/bar

Vault Graph 0.1

Graph generated
02 Sep 2026 22:00

Source commit
abc123

Nodes
142

Edges
317
```

Puis graphe interactif.

---

## 22. Graphe interactif

Minimum :

- déplacement ;
- zoom ;
- sélection d'un nœud ;
- sélection d'une relation ;
- recentrage ;
- recherche par label.

La v0 peut être 2D.

Pas d'exigence 3D.

---

## 23. Filtres

Filtrer par :

- type ;
- contexte ;
- état épistémique ;
- provenance.

Les valeurs doivent être découvertes dynamiquement depuis le graphe.

---

## 24. Inspection d'un nœud

Afficher :

```text
Label

Type

Context

Status

Sources

Incoming edges

Outgoing edges
```

---

## 25. Retour à la source

Lorsque possible, fournir un lien GitHub vers :

```text
fichier
+
commit
```

Idéalement avec ligne ou section.

Ainsi :

```text
Graph
↓
Node
↓
Source
↓
GitHub file
```

---

## 26. Actualisation

Le viewer doit proposer :

```text
Refresh
```

Ce bouton signifie :

> recharger le `.vault-graph` disponible dans GitHub.

Il **ne reconstruit pas** le graphe.

La reconstruction appartient à l'agent ou à un moteur futur.

---

## 27. Distribution — ZIP

Le repo produit automatiquement :

```text
dist/vault-graph-bootstrap.zip
```

Le ZIP contient uniquement :

```text
.vault-graph/
├── manifest.json
├── config.yaml
├── schema.yaml
├── INSTRUCTIONS.md
├── graph/
├── state/
└── reports/
```

L'utilisateur l'extrait dans son repo.

---

## 28. Distribution — contrat Claude

Le repo contient également :

```text
dist/CLAUDE_INSTALL_PROMPT.md
```

Exemple d'utilisation :

```text
Voici mon dépôt :

https://github.com/foo/bar

Installe Vault Graph conformément au protocole décrit ci-dessous.

[contrat]
```

L'objectif est que l'utilisateur puisse copier-coller **un seul prompt**.

---

## 29. Contrat Claude attendu

Le prompt doit demander à Claude :

1. accéder au repo ;
2. déterminer sa structure ;
3. installer `.vault-graph/` ;
4. adapter `config.yaml` ;
5. proposer le `schema.yaml` minimal nécessaire ;
6. scanner les sources ;
7. produire le premier graphe ;
8. produire les rapports ;
9. valider le manifeste ;
10. ne modifier aucun fichier hors `.vault-graph/`.

---

## 30. Mode update Claude

Après installation :

l'utilisateur ne doit plus avoir besoin du gros prompt.

Cette instruction doit suffire :

```text
Lis .vault-graph/INSTRUCTIONS.md et mets à jour le Vault Graph.
```

---

## 31. Repo produit par Claude

Le livrable demandé pour cette mission est un repo autonome :

```text
vault-graph/
│
├── README.md
├── CDC.md
├── LICENSE
│
├── template/
│   └── .vault-graph/
│
├── dist/
│   ├── vault-graph-bootstrap.zip
│   └── CLAUDE_INSTALL_PROMPT.md
│
├── viewer/
│   ├── src/
│   ├── package.json
│   └── ...
│
├── scripts/
│   ├── validate-template.*
│   └── build-bootstrap.*
│
└── .github/
    └── workflows/
        ├── pages.yml
        └── release.yml
```

---

## 32. GitHub Pages

Le viewer doit être automatiquement publié par :

```text
.github/workflows/pages.yml
```

Après push sur `main`.

Le README doit indiquer l'URL obtenue.

---

## 33. Bootstrap ZIP

Le ZIP doit pouvoir être régénéré depuis :

```text
template/.vault-graph/
```

Il ne doit pas être maintenu manuellement.

Par exemple :

```bash
npm run build:bootstrap
```

---

## 34. Validation

Prévoir une validation minimale :

```bash
npm test
```

ou :

```bash
npm run verify
```

Elle vérifie au minimum :

- template présent ;
- JSON valide ;
- YAML valide ;
- manifest cohérent ;
- fichiers référencés existants ;
- ZIP reproductible ;
- viewer buildable.

---

## 35. Fixture

Le vault BrainUniverse que nous avons préparé peut être utilisé comme fixture.

Mais :

**l'oracle de benchmark ne doit pas être inclus dans le corpus donné au moteur avant génération du premier graphe.**

---

## 36. Ce que le projet n'est pas

Ne pas construire :

- une base de données ;
- Neo4j ;
- RDF ;
- OWL ;
- SPARQL ;
- RAG ;
- moteur vectoriel ;
- serveur backend obligatoire ;
- authentification ;
- SaaS ;
- gestion utilisateur ;
- éditeur documentaire ;
- orchestrateur agentique ;
- système de plugins complet.

---

## 37. Repos privés

Hors périmètre de la v0.

Le design ne doit cependant pas empêcher plus tard :

```text
GitHub OAuth
```

ou :

```text
viewer local
```

---

## 38. 3D

Hors périmètre obligatoire.

Le viewer doit d'abord être utile.

Si la bibliothèque choisie rend une vue 3D triviale et sans complexité significative, elle peut être ajoutée comme vue secondaire.

Pas comme dépendance architecturale.

---

## 39. Principe de scalabilité

Le système doit pouvoir évoluer ainsi :

```text
V0

Agent
↓
.vault-graph
↓
viewer
```

puis éventuellement :

```text
V1

CLI déterministe
+
LLM pour sémantique
```

puis :

```text
V2

GitHub Action
↓
mise à jour automatique
```

sans modifier le contrat de base.

---

## 40. Principe fondamental

Le repo utilisateur possède son état.

Le moteur est remplaçable.

Le viewer est remplaçable.

Git fournit l'historique.

`.vault-graph` fournit le contrat.

---

## 41. Critère de réussite

La v0 est considérée réussie si je peux :

### Cas A

Télécharger :

```text
vault-graph-bootstrap.zip
```

l'extraire dans n'importe quel repo et dire :

> Lis `.vault-graph/INSTRUCTIONS.md` et initialise le graphe.

### Cas B

Copier :

```text
CLAUDE_INSTALL_PROMPT.md
```

y mettre l'URL d'un repo et laisser Claude installer le nécessaire.

### Puis

Ouvrir la webapp publiée.

Entrer :

```text
https://github.com/foo/bar
```

et obtenir :

- le graphe ;
- les métadonnées ;
- la provenance ;
- le commit source ;
- la **date de dernière génération** ;
- les candidats ;
- les éléments non résolus.

Sans aucune installation supplémentaire.

---

## 42. Règle finale d'implémentation

> Construire le plus petit système qui démontre le protocole.

Ne pas construire aujourd'hui ce que `.vault-graph` permet de différer à demain.

---

## Phrase produit

> **Vault Graph est un protocole portable permettant à n'importe quel dépôt Git d'exposer une représentation graphe contextualisée, traçable et reconstructible de son contenu via un simple dossier `.vault-graph`; sa génération et sa visualisation sont volontairement découplées.**
