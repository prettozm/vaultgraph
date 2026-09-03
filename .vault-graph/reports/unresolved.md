# Non résolus — orphelins et éléments sans rattachement justifié

Invariant CDC §14 : « zéro orphelin inexpliqué ». Un graphe totalement connecté n'est pas un
objectif ; un nœud isolé est légitime s'il porte une raison explicite.

## Orphelins (degré 0) — 1

### `source:note-idee-isolee` — « Note — Recette de pain au levain »
- **Type / contexte / statut** : `source` / `hors-sujet` / `explicit` (la note existe bel et
  bien dans le vault ; c'est son rattachement qui est absent).
- **Raison** : document explicitement sans rapport avec le Projet Lumen (farine, levain,
  cuisson) ; aucune relation justifiée par une source n'a été trouvée, et la note demande
  elle-même de ne pas être rattachée de force au reste du vault. Conservé comme orphelin
  explicite plutôt qu'ignoré : la connaissance « ce document existe et n'est relié à rien »
  est une information utile au lecteur du graphe.
- **Source** : `fixtures/demo-vault/notes/idee-isolee.md` (L23-31 pour la consigne de
  non-rattachement).
- **Action possible** : sortir la note du périmètre `scan.include` si elle n'a pas vocation à
  rester dans le vault ; sinon la laisser telle quelle.

## Nœuds `unresolved` — 0

## Arêtes `unresolved` — 0

## Suppressions (fichiers DELETED) — 0

Premier run (INIT) : aucun fichier supprimé, aucun nœud orphelin par perte de source.
