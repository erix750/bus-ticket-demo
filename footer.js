document.querySelectorAll("[data-current-year]").forEach(function(element) {
    const year = String(new Date().getFullYear());
    element.textContent = year;
    element.setAttribute("datetime", year);
});

const siteTranslations = {
    "Your journey, your way.": { rw: "Urugendo rwawe, uko ubishaka.", fr: "Votre voyage, à votre façon." },
    "Explore": { rw: "Menya Wayline", fr: "Découvrir" },
    "About": { rw: "Ibyerekeye", fr: "À propos" },
    "Find a Bus": { rw: "Shaka bisi", fr: "Trouver un bus" },
    "Our Routes": { rw: "Imihanda yacu", fr: "Nos itinéraires" },
    "Support": { rw: "Ubufasha", fr: "Assistance" },
    "Help Center": { rw: "Ubufasha", fr: "Centre d’aide" },
    "FAQs": { rw: "Ibibazo bikunze kubazwa", fr: "Questions fréquentes" },
    "Find My Booking": { rw: "Shaka booking yanjye", fr: "Retrouver ma réservation" },
    "Support contact information": { rw: "Uko wahamagara ubufasha", fr: "Coordonnées de l’assistance" },
    "Legal": { rw: "Amategeko", fr: "Informations légales" },
    "Privacy Policy": { rw: "Politiki y’ibanga", fr: "Politique de confidentialité" },
    "Terms of Service": { rw: "Amabwiriza yo gukoresha", fr: "Conditions d’utilisation" },
    "Cancellation Policy": { rw: "Politiki yo guhagarika booking", fr: "Politique d’annulation" },
    "Service": { rw: "Serivisi", fr: "Service" },
    "Service area: Rwanda.": { rw: "Aho dukorera: u Rwanda.", fr: "Zone desservie : Rwanda." },
    "Made in Rwanda": { rw: "Byakorewe mu Rwanda", fr: "Fabriqué au Rwanda" },
    "Language": { rw: "Ururimi", fr: "Langue" },
    "Turn on dark mode": { rw: "Fungura uburyo bwijimye", fr: "Activer le mode sombre" },
    "Turn off dark mode": { rw: "Zimya uburyo bwijimye", fr: "Désactiver le mode sombre" },
    "Light mode": { rw: "Uburyo busanzwe", fr: "Mode clair" },
    "Dark mode": { rw: "Uburyo bwijimye", fr: "Mode sombre" },
    "Install app": { rw: "Shyira porogaramu muri telefoni", fr: "Installer l’application" },
    "All rights reserved.": { rw: "Uburenganzira bwose burarinzwe.", fr: "Tous droits réservés." },
    "Created by": { rw: "Byakozwe na", fr: "Créé par" },
    "Skip": { rw: "Simbuka", fr: "Passer" },
    "Book your bus tickets easily, travel comfortably and reach your destination.": { rw: "Wandikisha itike ya bisi mu buryo bworoshye, ukagenda neza kandi ukajyera aho ujya amahoro.", fr: "Réservez facilement vos billets de bus, voyagez confortablement et arrivez à destination." },
    "Book Your Journey": { rw: "Bandika urugendo rwawe", fr: "Réserver votre voyage" },
    "Safe Travel": { rw: "Urugendo rutekanye", fr: "Voyage en sécurité" },
    "Your safety first": { rw: "Umutekano wawe ni wo uza mbere", fr: "Votre sécurité avant tout" },
    "Comfortable Rides": { rw: "Ingendo nziza", fr: "Voyages confortables" },
    "Travel in comfort": { rw: "Genda wishimye", fr: "Voyagez confortablement" },
    "Easy Booking": { rw: "Kubika byoroshye", fr: "Réservation facile" },
    "Fast and simple": { rw: "Byihuse kandi byoroshye", fr: "Rapide et simple" },
    "Seat Availability": { rw: "Imyanya ihari", fr: "Places disponibles" },
    "Check available seats before booking": { rw: "Reba imyanya ihari mbere yo kubika", fr: "Vérifiez les places disponibles avant de réserver" },
    "Why Choose WAYLINE?": { rw: "Kuki wahitamo WAYLINE?", fr: "Pourquoi choisir WAYLINE ?" },
    "Reliable Transport": { rw: "Ubwikorezi bwizewe", fr: "Transport fiable" },
    "Fare Details Before Booking": { rw: "Menya igiciro mbere yo kubika", fr: "Tarifs connus avant la réservation" },
    "Explore Rwanda Routes": { rw: "Menya ingendo zo mu Rwanda", fr: "Découvrez les itinéraires du Rwanda" },
    "Booking Reference": { rw: "Nomero ya booking", fr: "Référence de réservation" },
    "BOOK WITHOUT AN ACCOUNT": { rw: "BIKEGURWE UTIFUZIYE KONTI", fr: "RÉSERVEZ SANS COMPTE" },
    "Choose how to book": { rw: "Hitamo uko ubika", fr: "Choisissez comment réserver" },
    "Book online now, or use the USSD menu when the short code is activated.": { rw: "Bika kuri interineti ubu, cyangwa ukoreshe USSD igihe kode izaba yatangiye gukora.", fr: "Réservez en ligne maintenant, ou utilisez le menu USSD lorsque le code court sera activé." },
    "Start exploring": { rw: "Tangira gushakisha", fr: "Commencez à explorer" },
    "Browse Wayline and plan your journey without a passenger account.": { rw: "Reba Wayline utegure urugendo udafite konti y’umugenzi.", fr: "Parcourez Wayline et planifiez votre voyage sans compte passager." },
    "Set your route": { rw: "Hitamo inzira", fr: "Choisissez votre itinéraire" },
    "Compare trips": { rw: "Gereranya ingendo", fr: "Comparez les trajets" },
    "Add traveller details": { rw: "Andika amakuru y’umugenzi", fr: "Ajoutez les informations du voyageur" },
    "Choose where you are leaving from, where you are going and when you travel.": { rw: "Hitamo aho uva, aho ujya n’igihe uzagirira urugendo.", fr: "Choisissez votre lieu de départ, votre destination et la date du voyage." },
    "Check each company, departure time, fare and remaining seats.": { rw: "Reba kompanyi, igihe cyo guhaguruka, igiciro n’imyanya isigaye kuri buri rugendo.", fr: "Comparez la compagnie, l’heure de départ, le tarif et les places restantes." },
    "Enter a passenger name and phone number so the operator can reach you.": { rw: "Andika izina ry’umugenzi na nimero ya telefoni kugira ngo kompanyi ibashe kukugeraho.", fr: "Indiquez le nom du passager et son numéro de téléphone afin que la compagnie puisse vous joindre." },
    "Payment processing is not enabled yet, so no money is collected and bookings stay unpaid.": { rw: "Kwishyura ntibirakorwa, bityo nta mafaranga yakirwa kandi booking ziguma zitishyuwe.", fr: "Le paiement n’est pas encore activé : aucun montant n’est perçu et les réservations restent impayées." },
    "Your confirmation includes a booking reference. It is not a paid ticket; keep it for follow-up.": { rw: "Uhabwa nomero ya booking mu butumwa bwo kwemeza. Si itike yishyuwe; yibike kugira ngo uzayikoreshe nyuma.", fr: "Votre confirmation contient une référence de réservation. Ce n’est pas un billet payé ; conservez-la pour le suivi." },
    "Choose a payment option": { rw: "Hitamo uburyo bwo kwishyura", fr: "Choisissez un mode de paiement" },
    "Save your reference": { rw: "Bika nomero ya booking", fr: "Conservez votre référence" },
    "AVAILABLE ONLINE": { rw: "BIRABONEKA KURI INTERINETI", fr: "DISPONIBLE EN LIGNE" },
    "Book on the website": { rw: "Bika kuri uru rubuga", fr: "Réserver sur le site" },
    "Search buses": { rw: "Shaka bisi", fr: "Rechercher des bus" },
    "Search bus schedules, compare fares and available seats, then reserve with your name and phone number.": { rw: "Shaka ingengabihe za bisi, gereranya ibiciro n’imyanya ihari, hanyuma ubike ukoresheje izina na nimero ya telefoni.", fr: "Recherchez les horaires, comparez les tarifs et les places disponibles, puis réservez avec votre nom et votre numéro de téléphone." },
    "COMING SOON": { rw: "BIZAZA VUBA", fr: "BIENTÔT DISPONIBLE" },
    "Book by USSD": { rw: "Bika ukoresheje USSD", fr: "Réserver par USSD" },
    "On a basic phone, dial the code, choose a language, select your route and trip, enter your name, and confirm to receive a booking reference.": { rw: "Kuri telefoni isanzwe, hamagara kode, uhitemo ururimi, inzira n’urugendo, wandike amazina yawe, maze wemeze kugira ngo uhabwe nomero ya booking.", fr: "Sur un téléphone classique, composez le code, choisissez une langue, sélectionnez votre itinéraire et votre trajet, saisissez votre nom et confirmez pour recevoir une référence." },
    "Not active yet. Africa’s Talking must provision *200# and the USSD service must be deployed before you can dial it. USSD reservations will also remain unpaid.": { rw: "Ntibiratangira gukora. Africa’s Talking igomba kubanza gutanga *200# kandi serivisi ya USSD ikoherezwa kuri interineti. Booking za USSD na zo zizakomeza kutishyurwa.", fr: "Pas encore actif. Africa’s Talking doit attribuer *200# et le service USSD doit être déployé avant son utilisation. Les réservations USSD resteront également impayées." },
    "PLAN YOUR JOURNEY": { rw: "TEGURA URUGENDO RWAWE", fr: "PLANIFIEZ VOTRE VOYAGE" },
    "Find a bus": { rw: "Shaka bisi", fr: "Trouver un bus" },
    "Search and book without creating a passenger account.": { rw: "Shaka kandi ubike udafunguye konti y’umugenzi.", fr: "Recherchez et réservez sans créer de compte passager." },
    "Refresh seats": { rw: "Ongera urebe imyanya", fr: "Actualiser les places" },
    "Available routes": { rw: "Inzira zihari", fr: "Itinéraires disponibles" },
    "Planned routes across Rwanda": { rw: "Inzira ziteganyijwe mu Rwanda", fr: "Itinéraires prévus au Rwanda" },
    "Bus company": { rw: "Kompanyi ya bisi", fr: "Compagnie de bus" },
    "All bus companies": { rw: "Kompanyi zose za bisi", fr: "Toutes les compagnies de bus" },
    "Leaving from": { rw: "Aho uva", fr: "Départ" },
    "Going to": { rw: "Aho ujya", fr: "Destination" },
    "Travel date": { rw: "Itariki y’urugendo", fr: "Date du voyage" },
    "Passengers": { rw: "Abagenzi", fr: "Passagers" },
    "Enter your name (optional)": { rw: "Andika amazina yawe (si ngombwa)", fr: "Votre nom (facultatif)" },
    "Enter your name": { rw: "Andika amazina yawe", fr: "Saisissez votre nom" },
    "After you select a bus, enter the passenger's full name and phone number in the booking form.": { rw: "Umaze guhitamo bisi, andika amazina yuzuye y’umugenzi na nimero ya telefoni mu ifishi yo kubika.", fr: "Après avoir choisi un bus, indiquez le nom complet et le numéro de téléphone du passager dans le formulaire." },
    "Dashboard": { rw: "Imbonerahamwe", fr: "Tableau de bord" },
    "Schedule management": { rw: "Gucunga ingengabihe", fr: "Gestion des horaires" },
    "Bookings": { rw: "Booking", fr: "Réservations" },
    "Company dashboard": { rw: "Imbonerahamwe ya kompanyi", fr: "Tableau de bord de la compagnie" },
    "Manage your schedules and keep track of seat availability and bookings.": { rw: "Genzura ingengabihe zawe, imyanya ihari na booking.", fr: "Gérez vos horaires et suivez les places disponibles et les réservations." },
    "Upcoming bus schedules": { rw: "Ingengabihe za bisi ziri imbere", fr: "Prochains horaires de bus" },
    "Visible to passengers": { rw: "Bigaragara ku bagenzi", fr: "Visibles aux passagers" },
    "Saved booking records": { rw: "Booking zabitswe", fr: "Réservations enregistrées" },
    "Across active schedules": { rw: "Mu ngengabihe zikora", fr: "Sur les horaires actifs" },
    "Sign out": { rw: "Sohoka", fr: "Se déconnecter" },
    "Welcome back": { rw: "Urahawe ikaze", fr: "Bon retour" },
    "Total schedules": { rw: "Ingengabihe zose", fr: "Horaires au total" },
    "Active schedules": { rw: "Ingengabihe zikora", fr: "Horaires actifs" },
    "Quick actions": { rw: "Ibikorwa byihuse", fr: "Actions rapides" },
    "Add a schedule": { rw: "Ongeraho ingengabihe", fr: "Ajouter un horaire" },
    "Manage schedules": { rw: "Gucunga ingengabihe", fr: "Gérer les horaires" },
    "View bookings": { rw: "Reba booking", fr: "Voir les réservations" },
    "COMPANY PROFILE": { rw: "UMWIRONDORO WA KOMPANYI", fr: "PROFIL DE LA COMPAGNIE" },
    "WAYLINE PARTNERS": { rw: "ABAFATANYABIKORWA BA WAYLINE", fr: "PARTENAIRES WAYLINE" },
    "Edit profile picture": { rw: "Hindura ifoto ya kompanyi", fr: "Modifier la photo du profil" },
    "Choose the picture passengers will see with your company name and bus trips.": { rw: "Hitamo ifoto abagenzi bazabona iruhande rw’izina rya kompanyi n’ingendo za bisi.", fr: "Choisissez la photo que les passagers verront avec le nom de votre compagnie et ses trajets." },
    "No picture yet": { rw: "Nta foto irashyirwaho", fr: "Aucune photo pour le moment" },
    "Choose a company picture": { rw: "Hitamo ifoto ya kompanyi", fr: "Choisir une photo de la compagnie" },
    "Save profile picture": { rw: "Bika ifoto ya kompanyi", fr: "Enregistrer la photo du profil" },
    "SCHEDULES AND FARES": { rw: "INGENGABIHE N’IBICIRO", fr: "HORAIRES ET TARIFS" },
    "Manage your bus schedules": { rw: "Genzura ingengabihe za bisi", fr: "Gérez vos horaires de bus" },
    "Bus name or number": { rw: "Izina cyangwa nimero ya bisi", fr: "Nom ou numéro du bus" },
    "Company name": { rw: "Izina rya kompanyi", fr: "Nom de la compagnie" },
    "e.g. Coach 24": { rw: "urugero: Bisi 24", fr: "ex. : Car 24" },
    "Departure city": { rw: "Umujyi utangirirwamo", fr: "Ville de départ" },
    "Destination city": { rw: "Umujyi ujya", fr: "Ville de destination" },
    "Total seats": { rw: "Imyanya yose", fr: "Nombre total de places" },
    "City of Kigali (RWF 59.28 per km)": { rw: "Umujyi wa Kigali (RWF 59.28 kuri km)", fr: "Ville de Kigali (59,28 RWF par km)" },
    "Intercity / provincial (RWF 41.58 per km)": { rw: "Hagati y’imijyi / intara (RWF 41.58 kuri km)", fr: "Interurbain / province (41,58 RWF par km)" },
    "Complete every schedule field with a value.": { rw: "Uzuza imyanya yose y’ingengabihe.", fr: "Veuillez remplir tous les champs de l’horaire." },
    "Choose a language": { rw: "Hitamo ururimi", fr: "Choisir une langue" },
    "English": { rw: "Icyongereza", fr: "Anglais" },
    "Kinyarwanda": { rw: "Ikinyarwanda", fr: "Kinyarwanda" },
    "French": { rw: "Igifaransa", fr: "Français" },
    "What can we help you find?": { rw: "Ni iki twagufasha kubona?", fr: "Que recherchez-vous ?" },
    "Type a question or topic": { rw: "Andika ikibazo cyangwa ingingo", fr: "Saisissez une question ou un sujet" },
    "Frequently asked questions": { rw: "Ibibazo bikunze kubazwa", fr: "Questions fréquentes" },
    "Close": { rw: "Funga", fr: "Fermer" },
    "Company Sign In": { rw: "Kwinjira kwa kompanyi", fr: "Connexion de la compagnie" },
    "Complete your booking": { rw: "Uzuza booking yawe", fr: "Terminez votre réservation" },
    "Enter the passenger's full name and phone number below. No account is needed.": { rw: "Andika amazina yuzuye y’umugenzi na nimero ya telefoni hano hasi. Konti ntikenewe.", fr: "Saisissez ci-dessous le nom complet et le numéro de téléphone du passager. Aucun compte n’est nécessaire." },
    "Payments are not active yet. MTN Mobile Money and Airtel Money record your preference only; no money is collected and the booking remains unpaid.": { rw: "Kwishyura ntibirakora. MTN Mobile Money na Airtel Money byerekana gusa uburyo wahisemo; nta mafaranga yakirwa kandi booking ntiba yishyuwe.", fr: "Les paiements ne sont pas encore actifs. MTN Mobile Money et Airtel Money indiquent uniquement votre préférence ; aucun paiement n’est perçu et la réservation reste impayée." },
    "Bus fare": { rw: "Igiciro cya bisi", fr: "Tarif du bus" },
    "Total": { rw: "Igiteranyo", fr: "Total" },
    "Passenger full name": { rw: "Amazina yuzuye y’umugenzi", fr: "Nom complet du passager" },
    "Enter the passenger's full name": { rw: "Andika amazina yuzuye y’umugenzi", fr: "Saisissez le nom complet du passager" },
    "Phone number": { rw: "Nimero ya telefoni", fr: "Numéro de téléphone" },
    "Enter a number the bus company can use to contact you.": { rw: "Andika nimero kompanyi ya bisi ishobora kuguhamagaraho.", fr: "Saisissez un numéro auquel la compagnie de bus peut vous contacter." },
    "Intended payment method": { rw: "Uburyo uteganya kwishyura", fr: "Mode de paiement souhaité" },
    "Choose a payment method": { rw: "Hitamo uburyo bwo kwishyura", fr: "Choisissez un mode de paiement" },
    "Visa (coming soon)": { rw: "Visa (bizaza vuba)", fr: "Visa (bientôt disponible)" },
    "Mastercard (coming soon)": { rw: "Mastercard (bizaza vuba)", fr: "Mastercard (bientôt disponible)" },
    "Go back": { rw: "Subira inyuma", fr: "Retour" },
    "Review journey": { rw: "Ongera urebe urugendo", fr: "Vérifier le voyage" },
    "CHECK BEFORE SAVING": { rw: "GENZURA MBERE YO KUBIKA", fr: "VÉRIFIEZ AVANT D’ENREGISTRER" },
    "Review your journey": { rw: "Ongera urebe urugendo rwawe", fr: "Vérifiez votre voyage" },
    "Passenger": { rw: "Umugenzi", fr: "Passager" },
    "Bus": { rw: "Bisi", fr: "Bus" },
    "Route": { rw: "Inzira", fr: "Itinéraire" },
    "Intermediate stops": { rw: "Aho bisi ihagarara hagati", fr: "Arrêts intermédiaires" },
    "Departure": { rw: "Igihe cyo guhaguruka", fr: "Départ" },
    "Journey distance, duration and estimated arrival": { rw: "Intera, igihe cy’urugendo n’isaha yo kugera", fr: "Distance, durée et heure d’arrivée estimée" },
    "Passengers and seats left": { rw: "Abagenzi n’imyanya isigaye", fr: "Passagers et places restantes" },
    "Total amount due": { rw: "Amafaranga yose agomba kwishyurwa", fr: "Montant total à payer" },
    "Saving reserves seats, but does not collect payment or confirm a paid ticket.": { rw: "Kubika bigufatira imyanya ariko ntibyakira ubwishyu cyangwa ngo byemeze itike yishyuwe.", fr: "L’enregistrement réserve les places, mais ne perçoit aucun paiement et ne confirme pas un billet payé." },
    "Back to details": { rw: "Subira ku makuru", fr: "Retour aux détails" },
    "Save unpaid reservation": { rw: "Bika booking itishyuwe", fr: "Enregistrer la réservation impayée" },
    "BOOKING CONFIRMATION": { rw: "KWEMEZA BOOKING", fr: "CONFIRMATION DE RÉSERVATION" },
    "Your reservation is saved": { rw: "Booking yawe yabitswe", fr: "Votre réservation est enregistrée" },
    "REFERENCE": { rw: "NOMERO", fr: "RÉFÉRENCE" },
    "Copy reference": { rw: "Koporora nomero", fr: "Copier la référence" },
    "Journey": { rw: "Urugendo", fr: "Voyage" },
    "Travel date and departure time": { rw: "Itariki n’isaha yo guhaguruka", fr: "Date et heure de départ" },
    "Booking status": { rw: "Imiterere ya booking", fr: "État de la réservation" },
    "Payment status": { rw: "Imiterere y’ubwishyu", fr: "État du paiement" },
    "Done": { rw: "Byarangiye", fr: "Terminé" },
    "Add Wayline to your phone": { rw: "Shyira Wayline muri telefoni yawe", fr: "Ajouter Wayline à votre téléphone" },
    "Got it": { rw: "Ndabyumvise", fr: "Compris" },
    "BOOKING ACCESS": { rw: "KUBONA BOOKING", fr: "ACCÈS À LA RÉSERVATION" },
    "Enter your booking reference and the phone number you used at checkout. We’ll verify your phone with a one-time code before showing your reservation.": { rw: "Andika nomero ya booking na nimero ya telefoni wakoresheje. Tuzohereza kode yo kugenzura nimero yawe mbere yo kukwereka booking.", fr: "Saisissez la référence de réservation et le numéro utilisé lors du paiement. Nous vérifierons votre téléphone avec un code unique avant d’afficher votre réservation." },
    "Booking reference": { rw: "Nomero ya booking", fr: "Référence de réservation" },
    "Enter your booking reference": { rw: "Andika nomero ya booking", fr: "Saisissez votre référence de réservation" },
    "Phone number used at booking": { rw: "Nimero ya telefoni yakoreshejwe mu booking", fr: "Numéro utilisé pour la réservation" },
    "Rwanda mobile numbers only.": { rw: "Nimero za telefoni zo mu Rwanda gusa.", fr: "Numéros de téléphone rwandais uniquement." },
    "Send verification code": { rw: "Ohereza kode yo kugenzura", fr: "Envoyer le code de vérification" },
    "SMS verification code": { rw: "Kode yo kugenzura ya SMS", fr: "Code de vérification SMS" },
    "Enter the 6-digit code": { rw: "Andika kode y’imibare 6", fr: "Saisissez le code à 6 chiffres" },
    "Verify and find booking": { rw: "Emeza ushake booking", fr: "Vérifier et retrouver la réservation" },
    "Send a new code": { rw: "Ohereza indi kode", fr: "Envoyer un nouveau code" },
    "Change details": { rw: "Hindura amakuru", fr: "Modifier les informations" },
    "Return to Wayline": { rw: "Subira kuri Wayline", fr: "Retour à Wayline" },
    "RWF fare area": { rw: "Agace k’igiciro cya RWF", fr: "Zone tarifaire en RWF" },
    "Choose a fare area": { rw: "Hitamo agace k’igiciro", fr: "Choisissez une zone tarifaire" },
    "One-way route distance (km)": { rw: "Intera y’urugendo rw’icyerekezo kimwe (km)", fr: "Distance du trajet aller (km)" },
    "Calculate or enter distance": { rw: "Bara cyangwa wandike intera", fr: "Calculez ou saisissez la distance" },
    "Calculate road distance": { rw: "Bara intera yo mu muhanda", fr: "Calculer la distance routière" },
    "Estimated journey duration (minutes)": { rw: "Igihe cy’urugendo kigereranyijwe (iminota)", fr: "Durée estimée du trajet (minutes)" },
    "Optional; verify with operator": { rw: "Si ngombwa; genzura na kompanyi", fr: "Facultatif ; à vérifier auprès de la compagnie" },
    "Intermediate stops (optional)": { rw: "Aho bisi ihagarara hagati (si ngombwa)", fr: "Arrêts intermédiaires (facultatif)" },
    "Enter stops in order, separated by commas": { rw: "Andika aho ihagarara ukurikiranye, ukoreshe akitso", fr: "Saisissez les arrêts dans l’ordre, séparés par des virgules" },
    "Add bus schedule": { rw: "Ongeraho ingengabihe ya bisi", fr: "Ajouter un horaire de bus" },
    "Cancel edit": { rw: "Reka guhindura", fr: "Annuler la modification" },
    "Profile picture saved.": { rw: "Ifoto ya kompanyi yabitswe.", fr: "Photo de profil enregistrée." },
    "Choose a picture to upload.": { rw: "Hitamo ifoto wohereza.", fr: "Choisissez une photo à téléverser." },
    "Choose a PNG, JPG, or WebP image.": { rw: "Hitamo ifoto yo mu bwoko bwa PNG, JPG cyangwa WebP.", fr: "Choisissez une image PNG, JPG ou WebP." },
    "The company picture must be 10 MB or smaller.": { rw: "Ifoto ya kompanyi igomba kuba itarengeje MB 10.", fr: "La photo de la compagnie doit faire 10 Mo ou moins." },
    "The company image must be 10 MB or smaller.": { rw: "Ifoto ya kompanyi igomba kuba itarengeje MB 10.", fr: "L’image de la compagnie doit faire 10 Mo ou moins." },
    "Select bus": { rw: "Hitamo bisi", fr: "Choisir ce bus" },
    "This company does not have any upcoming bus schedules yet.": { rw: "Iyi kompanyi nta ngengabihe za bisi iri imbere ifite ubu.", fr: "Cette compagnie n’a pas encore d’horaires de bus à venir." },
    "Saved": { rw: "Byabitswe", fr: "Enregistré" },
    "Unpaid": { rw: "Ntibyishyuwe", fr: "Impayé" },
    "BOOKING REF": { rw: "NOMERO YA BOOKING", fr: "RÉFÉRENCE" },
    "Reference copied": { rw: "Nomero yakoporowe", fr: "Référence copiée" },
    "Print booking details": { rw: "Shyira amakuru ya booking kuri printer", fr: "Imprimer les détails de la réservation" },
    "If SMS delivery is available, your verification code should arrive shortly.": { rw: "Niba SMS ziri gukora, kode yo kugenzura iraza kugera vuba.", fr: "Si l’envoi de SMS est disponible, votre code de vérification devrait arriver bientôt." },
    "A new verification code was requested. Wait a moment for SMS delivery.": { rw: "Kode nshya yo kugenzura yasabwe. Tegereza gato ko SMS igera.", fr: "Un nouveau code a été demandé. Patientez le temps de recevoir le SMS." },
    "We couldn’t find a booking for that reference and verified phone number. Check both and try again.": { rw: "Nta booking ibonetse kuri iyo nomero na telefoni yagenzuwe. Reba byombi wongere ugerageze.", fr: "Aucune réservation ne correspond à cette référence et à ce numéro vérifié. Vérifiez-les et réessayez." },
    "Booking found. Keep the reference available when contacting the bus company.": { rw: "Booking yabonetse. Bika nomero yayo igihe uhamagaye kompanyi ya bisi.", fr: "Réservation trouvée. Gardez la référence à portée de main pour contacter la compagnie de bus." },
    "suggestion": { rw: "igitekerezo", fr: "suggestion" },
    "suggestions": { rw: "ibitekerezo", fr: "suggestions" },
    "Wayline. All rights reserved.": { rw: "Wayline. Uburenganzira bwose burarinzwe.", fr: "Wayline. Tous droits réservés." }
};

const languageNames = { en: "English", rw: "Kinyarwanda", fr: "French" };
const translationReverse = { en: {}, rw: {}, fr: {} };
Object.keys(siteTranslations).forEach(function(source) {
    ["rw", "fr"].forEach(function(language) {
        translationReverse[language][siteTranslations[source][language]] = source;
    });
});

function getCanonicalTranslation(value) {
    return translationReverse.rw[value] || translationReverse.fr[value] || value;
}

function translatedValue(value, language) {
    const source = getCanonicalTranslation(value);
    return language === "en" ? source : siteTranslations[source]?.[language] || source;
}

const languagePreferenceKey = "wayline-language";
let currentLanguage = "en";
try {
    const savedLanguage = localStorage.getItem(languagePreferenceKey);
    if (Object.prototype.hasOwnProperty.call(languageNames, savedLanguage)) currentLanguage = savedLanguage;
} catch (error) {
    console.error("Could not read the Wayline language preference.", error);
}

function translateTextNode(node) {
    const original = node.nodeValue;
    const trimmed = original.trim();
    if (!trimmed) return;
    const translated = translatedValue(trimmed, currentLanguage);
    if (translated === trimmed) return;
    const startWhitespace = original.match(/^\s*/)[0];
    const endWhitespace = original.match(/\s*$/)[0];
    node.nodeValue = startWhitespace + translated + endWhitespace;
}

function translateElementAttributes(element) {
    ["placeholder", "title", "aria-label", "alt"].forEach(function(attribute) {
        if (!element.hasAttribute(attribute)) return;
        const value = element.getAttribute(attribute);
        const translated = translatedValue(value, currentLanguage);
        if (translated !== value) element.setAttribute(attribute, translated);
    });
}

function translateTree(root) {
    if (root.nodeType === Node.TEXT_NODE) {
        translateTextNode(root);
        return;
    }
    if (root.nodeType !== Node.ELEMENT_NODE && root !== document) return;
    if (root.nodeType === Node.ELEMENT_NODE) translateElementAttributes(root);
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) translateTextNode(node);
    root.querySelectorAll?.("*").forEach(translateElementAttributes);
}

function installLanguageSelector() {
    const footerGroup = document.querySelector(".footer-link-group:last-child");
    if (!footerGroup) return;
    let controls = footerGroup.querySelector(".footer-controls");
    if (!controls) {
        controls = document.createElement("div");
        controls.className = "footer-controls";
        footerGroup.appendChild(controls);
    }
    const label = document.createElement("label");
    label.className = "footer-language-control";
    label.htmlFor = "siteLanguage";
    label.textContent = "Language";
    const select = document.createElement("select");
    select.id = "siteLanguage";
    select.setAttribute("aria-label", "Language");
    Object.keys(languageNames).forEach(function(language) {
        const option = document.createElement("option");
        option.value = language;
        option.textContent = languageNames[language];
        select.appendChild(option);
    });
    select.value = currentLanguage;
    select.addEventListener("change", function() {
        currentLanguage = select.value;
        document.documentElement.lang = currentLanguage === "rw" ? "rw" : currentLanguage;
        try {
            localStorage.setItem(languagePreferenceKey, currentLanguage);
        } catch (error) {
            console.error("Could not save the Wayline language preference.", error);
        }
        translateTree(document);
        select.value = currentLanguage;
    });
    label.appendChild(select);
    controls.prepend(label);
}

if (!document.querySelector(".policy-page")) {
    installLanguageSelector();
    document.documentElement.lang = currentLanguage === "rw" ? "rw" : currentLanguage;
    translateTree(document);
    new MutationObserver(function(mutations) {
        mutations.forEach(function(mutation) {
            if (mutation.type === "characterData") translateTextNode(mutation.target);
            mutation.addedNodes?.forEach(translateTree);
        });
    }).observe(document.body, { childList: true, characterData: true, subtree: true });
}

const helpSearch = document.getElementById("footerHelpSearch");
const helpList = document.getElementById("footerFaqList");
if (helpSearch && helpList) {
    const helpItems = Array.from(helpList.querySelectorAll(".faq-item"));
    const helpCount = document.getElementById("footerHelpCount");
    const helpEmpty = document.getElementById("footerHelpEmpty");
    const normalizeHelpText = function(value) {
        return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();
    };

    helpSearch.addEventListener("input", function() {
        const terms = normalizeHelpText(helpSearch.value.trim()).split(/\s+/).filter(Boolean);
        let visibleCount = 0;
        helpItems.forEach(function(item) {
            const text = normalizeHelpText(item.textContent);
            const matches = terms.every(function(term) { return text.includes(term); });
            item.hidden = !matches;
            if (matches) visibleCount += 1;
        });
        helpCount.textContent = visibleCount + (visibleCount === 1 ? " suggestion" : " suggestions");
        helpEmpty.hidden = visibleCount > 0;
    });
}
