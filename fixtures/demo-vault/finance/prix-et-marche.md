# Prix et marché

## Positionnement envisagé

L'équipe a étudié un prix de lancement autour de 45 € pour la lampe
Lumen, dans un marché où les produits concurrents se situent entre
25 € et 60 €. Ce positionnement doit être cohérent avec le besoin
d'un prix accessible exprimé dans `besoins/utilisateurs.md`.

## Résistance du marché à un tarif élevé

L'analyse de marché met en évidence une **résistance** nette des
acheteurs dès que le prix dépasse un certain seuil psychologique.
Cette résistance du marché n'a rien à voir avec un composant
électronique : il s'agit ici d'une réticence des consommateurs à
payer davantage, observée lors d'entretiens et de tests de prix en
boutique (voir le scénario d'achat, `cas-usage/scenarios.md`).

## Seuil de résistance du prix

Les tests réalisés suggèrent qu'un seuil de résistance du prix se
situe autour de 60 €, au-delà duquel une majorité de clients
interrogés déclarent préférer un modèle concurrent moins cher, quitte
à sacrifier l'autonomie. Ce seuil reste une donnée fragile : voir
l'hypothèse correspondante dans
`hypotheses/hypotheses-ouvertes.md`.

## Décision de prix de lancement

Sur la base de cette analyse, la décision de fixer le prix de
lancement est documentée dans
`decisions/ADR-002-prix-de-lancement.md`.

## Impact du changement de batterie

Le changement de chimie de batterie décrit dans
`notes/2026-08-changement-batterie.md` a été motivé en partie par
cette résistance du marché au prix : réduire le coût de la batterie
permet de préserver une marge tout en restant sous le seuil de
résistance identifié ici.
