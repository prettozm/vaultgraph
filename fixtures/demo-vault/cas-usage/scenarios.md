# Scénarios d'usage

## Scénario 1 — Soirée dans un foyer sans électricité

Une famille utilise la lampe Lumen posée au centre de la pièce
principale pendant les repas du soir. L'éclairage doit rester stable
pendant plusieurs heures. Ce scénario illustre directement le besoin
d'autonomie prolongée décrit dans `besoins/utilisateurs.md`.

## Scénario 2 — Déplacement nocturne

Un utilisateur transporte la lampe à la main pour se déplacer entre
deux bâtiments. Elle doit résister aux chocs légers et fonctionner
immédiatement, sans procédure d'allumage complexe — ce qui renvoie
au besoin de simplicité d'usage.

## Scénario 3 — Exposition prolongée au soleil en journée

La lampe est laissée en plein soleil toute la journée pour se
recharger, posée sur un rebord de fenêtre ou un toit. Le boîtier peut
alors atteindre une température élevée, ce qui met à l'épreuve les
choix décrits dans `electronique/thermique.md`.

## Fonctionnalité dérivée : mode veille automatique

Pour répondre au besoin d'autonomie prolongée, l'équipe a défini une
fonctionnalité de **mode veille automatique** : la lampe réduit
automatiquement son intensité lumineuse après une période
d'inactivité détectée, afin d'économiser l'énergie stockée. Cette
fonctionnalité est directement dérivée du besoin d'autonomie
prolongée exprimé dans `besoins/utilisateurs.md`, et non d'une
contrainte technique du circuit.

## Scénario 4 — Achat en boutique locale

Un client hésite en boutique entre la lampe Lumen et un modèle
concurrent moins cher. Ce scénario est directement lié à l'analyse
de résistance du marché au prix, décrite dans
`finance/prix-et-marche.md`.
