# Hypothèses ouvertes

## Avertissement

Les éléments listés ici sont des **hypothèses non vérifiées**. Elles
ne doivent jamais être présentées ou traitées comme des faits établis
tant qu'elles n'ont pas été confirmées par une étude terrain ou un
test contrôlé.

## Hypothèse — acceptation du prix par les utilisateurs

Hypothèse : les utilisateurs cibles accepteront un prix de lancement
supérieur à 60 € si l'autonomie promise (trois nuits sans recharge)
est effectivement démontrée en usage réel. Cette hypothèse n'a pas
été testée au-delà d'entretiens déclaratifs ; elle conditionne en
partie la marge de manœuvre évoquée dans
`decisions/ADR-002-prix-de-lancement.md`.

## Hypothèse — tolérance thermique de la batterie Li-ion NMC

Hypothèse : la protection logicielle de coupure en cas de surchauffe,
introduite dans `notes/2026-08-changement-batterie.md`, suffira à
compenser la moindre tolérance thermique de la batterie Li-ion NMC
par rapport à la LiFePO4. Cette hypothèse reste à valider par des
tests en conditions réelles d'exposition solaire, décrites dans
`electronique/thermique.md`.

## Hypothèse — comportement du marché au-delà de 45 °C ambiants

Hypothèse : le taux de panne des produits électroniques comparables
au-delà de 45 °C ambiants, évoqué de façon informelle par les
utilisateurs interrogés (`besoins/utilisateurs.md`), reflète un
phénomène généralisable à la lampe Lumen. Aucune donnée chiffrée
propre au produit ne vient encore confirmer cette généralisation.

## Statut de ces hypothèses

Aucune de ces trois hypothèses n'est aujourd'hui confirmée. Elles
doivent rester marquées comme telles dans toute représentation du
projet, y compris dans un graphe de connaissance dérivé de ce vault.
