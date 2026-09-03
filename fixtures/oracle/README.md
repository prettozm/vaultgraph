# Oracle de benchmark — `expected.json`

## Nature de ce dossier

Ce dossier contient un **oracle de benchmark caché** : un jeu
d'assertions machine-vérifiables sur le graphe attendu à partir du
vault `fixtures/demo-vault/`. Il ne fait pas partie du corpus
documentaire du projet fictif "Projet Lumen" et ne doit **jamais**
être traité comme une source de connaissance par le moteur de
graphe.

## Règle impérative (CDC §35)

**`fixtures/oracle/` doit être exclu de tout `config.yaml` de scan**
généré ou utilisé pour `fixtures/demo-vault/`, et son contenu ne doit
**pas être communiqué à l'agent qui génère le graphe avant que ce
premier graphe n'ait été produit**. L'oracle sert exclusivement à
l'évaluation a posteriori, par un agent indépendant (le "checker"),
du graphe déjà généré.

## Comment un checker doit l'utiliser

1. Le moteur (Maker) génère `.vault-graph/` à partir de
   `fixtures/demo-vault/` uniquement, sans avoir vu `expected.json`.
2. Une fois le graphe produit, un agent indépendant (Checker) charge
   `fixtures/oracle/expected.json` et vérifie chacune de ses
   assertions contre le graphe produit (nœuds, relations, statuts,
   provenance).
3. Le Checker rapporte les écarts sans modifier ni le vault, ni le
   graphe, ni l'oracle.

## Structure de `expected.json`

- `min_nodes` / `min_edges` — bornes minimales de taille du graphe.
- `homonyms` — paires de nœuds qui doivent rester distincts malgré un
  label identique, avec leurs contextes attendus.
- `types_present` — types de nœuds qui doivent apparaître au moins
  une fois.
- `expected_orphans` — nœuds attendus comme orphelins expliqués.
- `expected_conflicts` — paires de documents dont la relation doit
  être marquée comme contradiction ou supersession.
- `hypotheses` — nœuds qui doivent être typés `hypothese` et ne
  jamais porter un statut `confirmed`.
- `provenance` — exigences générales sur la traçabilité des nœuds.
- `expected_labels_regex` — expressions régulières que certains
  labels du graphe doivent satisfaire.

Chaque assertion de ce fichier est directement dérivable du texte de
`fixtures/demo-vault/` ; aucune ne repose sur une connaissance
externe au vault.
