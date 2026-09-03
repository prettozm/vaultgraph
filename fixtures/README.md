# Fixtures — vault de démonstration et oracle de benchmark

## Pourquoi ce dossier existe

Le vault de référence prévu pour ce projet, **BrainUniverse**, n'est
pas disponible dans cet environnement. `fixtures/demo-vault/` est un **vault de
substitution synthétique**, en français, conçu pour exercer
délibérément les mêmes cas obligatoires que ceux décrits dans le
CDC, afin de permettre le développement et l'évaluation du moteur de
graphe sans dépendre de la fixture d'origine.

## Contenu

- `demo-vault/` — un petit corpus documentaire cohérent (13 fichiers
  Markdown) sur un projet fictif, "Projet Lumen" (conception d'une
  lampe solaire portable), avec un volet technique (électronique) et
  un volet financier (prix et marché).
- `oracle/` — un **oracle de benchmark caché** : un jeu d'assertions
  machine-vérifiables décrivant ce qu'un graphe correct doit
  contenir, à utiliser uniquement après la première génération de
  graphe (voir `oracle/README.md`).

## Cas obligatoires couverts par `demo-vault/`

- **Homonymie contextuelle** : "résistance" désigne un composant
  électronique dans `demo-vault/electronique/alimentation-led.md` et
  un phénomène de marché dans `demo-vault/finance/prix-et-marche.md`
  — deux nœuds distincts, jamais fusionnés.
- **Orphelin expliqué** : `demo-vault/notes/idee-isolee.md` est une
  note volontairement sans rapport avec le reste du projet ; un
  moteur correct doit la laisser orpheline, avec une raison, plutôt
  que de la relier de force.
- **Contradiction / supersession** : `demo-vault/notes/2026-08-changement-batterie.md`
  contredit et remplace la décision prise dans
  `demo-vault/decisions/ADR-001-batterie.md`.
- **Hypothèses non vérifiées** : `demo-vault/hypotheses/hypotheses-ouvertes.md`
  contient des hypothèses explicites qui ne doivent jamais être
  présentées comme des faits établis.
- **Filiation (`derive_de`)** : la fonctionnalité "mode veille
  automatique" décrite dans `demo-vault/cas-usage/scenarios.md` est
  explicitement dérivée d'un besoin défini dans
  `demo-vault/besoins/utilisateurs.md`.
- **Raffinement (`raffine`)** : `demo-vault/electronique/thermique.md`
  précise et raffine une estimation donnée antérieurement dans
  `demo-vault/electronique/alimentation-led.md`.

## Portée du scan

Le `.vault-graph/` généré à la racine du dépôt doit scanner
**uniquement** `fixtures/demo-vault/`. Le dossier `fixtures/oracle/`
doit être explicitement exclu de tout `config.yaml` de scan, et ne
doit pas être fourni au moteur avant la première génération du
graphe (CDC §35).
