# ADR-001 — Choix de la technologie de batterie

## Statut

Accepté (2026-05-14). Voir toutefois `notes/2026-08-changement-batterie.md`
pour une évolution ultérieure de cette décision.

## Contexte

La lampe Lumen doit satisfaire le besoin d'autonomie prolongée
(`besoins/utilisateurs.md`) tout en supportant les contraintes
thermiques identifiées dans `electronique/thermique.md`, notamment
une exposition possible à des températures de surface élevées.

## Décision

L'équipe retient une batterie **LiFePO4** (lithium fer phosphate)
comme technologie de stockage pour la première version du produit.

## Justification

La chimie LiFePO4 offre trois avantages jugés déterminants à ce
stade : une meilleure tolérance thermique que les autres chimies
lithium courantes, un nombre de cycles de charge/décharge plus élevé,
et un risque d'emballement thermique nettement plus faible — un
critère de sécurité important pour un produit grand public utilisé
sans supervision technique.

## Conséquences

Le coût unitaire de la batterie LiFePO4 est supérieur à celui d'une
batterie Li-ion classique, ce qui pèse sur le prix de revient et
doit être pris en compte dans l'analyse de `finance/prix-et-marche.md`.

## Alternatives considérées

Une batterie Li-ion NMC standard a été envisagée pour son coût plus
faible, mais écartée initialement en raison d'une tolérance
thermique jugée insuffisante au regard du scénario d'exposition
solaire prolongée.
