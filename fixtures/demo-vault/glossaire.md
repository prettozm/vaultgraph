# Glossaire

## Autonomie

Durée pendant laquelle la lampe Lumen peut fonctionner sans recharge
solaire, exprimée en nombre de nuits d'usage normal. Voir
`besoins/utilisateurs.md`.

## Batterie LiFePO4

Chimie de batterie lithium fer phosphate, retenue initialement dans
`decisions/ADR-001-batterie.md` pour sa tolérance thermique et sa
sécurité, avant d'être remise en question dans
`notes/2026-08-changement-batterie.md`.

## Batterie Li-ion NMC

Chimie de batterie lithium nickel-manganèse-cobalt, moins coûteuse
que la LiFePO4 mais moins tolérante à la chaleur, retenue en
remplacement dans `notes/2026-08-changement-batterie.md`.

## Résistance (électronique)

Contexte : électronique. Composant passif qui limite le courant
circulant dans un circuit, dissipant de l'énergie sous forme de
chaleur. Dans Lumen, une résistance de limitation protège la LED de
puissance — voir `electronique/alimentation-led.md`. À ne pas
confondre avec la résistance de marché définie ci-dessous.

## Résistance (finance)

Contexte : finance / marché. Réticence observée des consommateurs à
accepter un prix au-delà d'un certain seuil psychologique. Dans
Lumen, cette résistance du marché est analysée dans
`finance/prix-et-marche.md` et a motivé la décision de prix de
`decisions/ADR-002-prix-de-lancement.md`. Sans lien avec le composant
électronique du même nom.

## Hypothèse

Affirmation non vérifiée sur laquelle le projet s'appuie
provisoirement, à ne jamais présenter comme un fait établi. Voir
`hypotheses/hypotheses-ouvertes.md`.

## Prix de lancement

Prix auquel la lampe Lumen sera proposée à sa sortie sur le marché,
fixé à 45 € dans `decisions/ADR-002-prix-de-lancement.md`.

## Mode veille automatique

Fonctionnalité qui réduit automatiquement l'intensité lumineuse après
une période d'inactivité, dérivée du besoin d'autonomie prolongée.
Voir `cas-usage/scenarios.md`.
