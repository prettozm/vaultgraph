# Note — Changement de batterie (août 2026)

## Contexte de la révision

Trois mois après l'acceptation de `decisions/ADR-001-batterie.md`,
le fournisseur pressenti pour la batterie LiFePO4 a annoncé une
hausse de tarif de 30 %, ce qui met en péril l'équilibre du prix de
lancement fixé dans `decisions/ADR-002-prix-de-lancement.md`.

## Décision révisée

Après discussion en équipe, nous revenons sur le choix initial :
la lampe Lumen embarquera finalement une batterie **Li-ion NMC**
standard plutôt que la batterie LiFePO4 retenue dans
`decisions/ADR-001-batterie.md`. Cette note **contredit et remplace**
la décision ADR-001 sur le choix de la chimie de batterie.

## Motivation principale

Le coût unitaire de la batterie Li-ion NMC est inférieur de près de
40 % à celui de la LiFePO4, ce qui permet de préserver la marge
prévue au prix de lancement de 45 € sans en modifier la valeur.

## Risque assumé

Cette bascule réintroduit le risque thermique que l'ADR-001 avait
justement écarté : la chimie Li-ion NMC tolère moins bien les
températures élevées décrites dans `electronique/thermique.md`.
L'équipe a décidé d'assumer ce risque en ajoutant une protection
logicielle de coupure en cas de surchauffe, plutôt qu'en changeant
de chimie.

## Statut de cette révision

Cette note constitue la décision la plus récente concernant la
chimie de batterie du Projet Lumen ; elle prévaut sur
`decisions/ADR-001-batterie.md` tant qu'un nouvel ADR formel n'a pas
été rédigé pour l'entériner.
