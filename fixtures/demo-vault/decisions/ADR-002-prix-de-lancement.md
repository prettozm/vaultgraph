# ADR-002 — Prix de lancement

## Statut

Accepté (2026-06-02).

## Contexte

L'analyse de marché (`finance/prix-et-marche.md`) identifie un seuil
de résistance du prix autour de 60 €, tandis que le besoin d'un prix
accessible (`besoins/utilisateurs.md`) impose de rester nettement
en dessous de ce seuil pour convaincre les foyers à revenu modeste.

## Décision

Le prix de lancement de la lampe Lumen est fixé à **45 €** pour le
marché de lancement.

## Justification

Ce prix se situe confortablement sous le seuil de résistance
identifié, tout en dégageant une marge jugée suffisante compte tenu
du coût de la batterie LiFePO4 retenue dans
`decisions/ADR-001-batterie.md`.

## Conséquences

Ce prix suppose un coût de production maîtrisé. Toute hausse
significative du coût de la batterie remettrait en cause l'équilibre
de cette décision, ce qui est précisément ce qui se produit dans
`notes/2026-08-changement-batterie.md`.

## Risque identifié

Le prix de 45 € repose sur l'hypothèse, non encore confirmée sur le
terrain, que les utilisateurs cibles accepteront ce niveau de prix
pour les bénéfices d'autonomie promis. Voir
`hypotheses/hypotheses-ouvertes.md`.
