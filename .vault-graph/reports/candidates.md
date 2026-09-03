# Candidats — éléments incertains à arbitrer

Un candidat est une relation (ou un nœud) plausible que le moteur ne peut pas asseoir sur une
formulation explicite d'une source. Il reste visible et filtrable dans le viewer (chip « candidate
relations ») tant qu'un humain ou un run ultérieur ne l'a pas confirmé ou rejeté.

## Arêtes candidates (5)

### edge:0016 — `besoin:robustesse-thermique` —related_to→ `concept:bilan-thermique-boitier`
- **Pourquoi** : la source (`besoins/utilisateurs.md` L21-27) renvoie au document `electronique/thermique.md`
  sans nommer le bilan thermique ; lien documentaire, pas relation énoncée. (Révision 2 : était `fonde` explicit.)
- **Arbitrage** : confirmer `related_to`, ou requalifier si le besoin fonde réellement le bilan.

### edge:0058 — `hypothese:acceptation-du-prix` —fonde→ `decision:adr-002-prix-de-lancement`
- **Pourquoi** : ADR-002 (L33-38) « repose sur l'hypothèse … que les utilisateurs accepteront ce niveau de
  prix » (45 €) ; le fichier hypothèses (L10-17) énonce « accepteront un prix supérieur à 60 € » et dit
  seulement que l'hypothèse « conditionne en partie la marge de manœuvre » d'ADR-002. Deux propositions
  voisines mais distinctes : garder `explicit` reviendrait à les fusionner. (Révision 2.)
- **Arbitrage** : scinder en deux hypothèses (45 € / > 60 €) ou confirmer le lien affaibli.

### edge:0062 — `hypothese:generalisation-taux-de-panne` —derive_de→ `besoin:robustesse-thermique`
- **Pourquoi** : la source (`hypotheses-ouvertes.md` L28-34) mentionne un point « évoqué de façon
  informelle par les utilisateurs interrogés (`besoins/utilisateurs.md`) » : renvoi de fichier, pas de
  dérivation énoncée. Même niveau de preuve que edge:0063. (Révision 2.)

### edge:0063 — `concept:bilan-thermique-boitier` —related_to→ `hypothese:generalisation-taux-de-panne`
- **Pourquoi** : proximité thématique (échauffement) sans citation croisée ;
  `electronique/thermique.md` L36-41 + `hypotheses/hypotheses-ouvertes.md` L28-34.

### edge:0064 — `hypothese:acceptation-du-prix` —contredit→ `concept:seuil-de-resistance-du-prix`
- **Pourquoi** : une hypothèse ouverte (> 60 €) face à une observation de marché (seuil ~60 €) ; la
  marquer `explicit` transformerait l'hypothèse en fait (CDC §15).
  `hypotheses-ouvertes.md` L10-17 + `finance/prix-et-marche.md` L19-26.

## Nœuds candidats (0)

Tous les nœuds ont une provenance explicite (fichier + titre + lignes).

## Rejets (0)

`rejected` est réservé au sens épistémique (nœud réfuté ou supplanté). `concept:regulateur-a-decoupage`
— alternative technique explicitement **non retenue** par la source (`alimentation-led.md` L29-34) — est
un concept documenté : statut `explicit` depuis la révision 2 ; le « non retenu » est porté par le texte
source et par l'arête `edge:0035`.
