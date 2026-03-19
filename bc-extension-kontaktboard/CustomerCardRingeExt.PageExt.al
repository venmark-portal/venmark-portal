/// <summary>
/// Tilføjer Ringeliste- og Kontaktperson-faneblade til Customer Card.
/// </summary>
pageextension 50300 "Venmark Customer Card Ext" extends "Customer Card"
{
    layout
    {
        addlast(content)
        {
            // ── Ringeliste ────────────────────────────────────────────────────
            group(RingeFaneblad)
            {
                Caption = 'Ringeliste';

                group(RingeDageGrp)
                {
                    Caption = 'Ringedage';
                    Description = 'Marker hvilke ugedage kunden skal ringes op';

                    field("Ringe Mandag"; Rec."Ringe Mandag")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Kunden ringes op om mandagen';
                    }
                    field("Ringe Tirsdag"; Rec."Ringe Tirsdag")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Kunden ringes op om tirsdagen';
                    }
                    field("Ringe Onsdag"; Rec."Ringe Onsdag")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Kunden ringes op om onsdagen';
                    }
                    field("Ringe Torsdag"; Rec."Ringe Torsdag")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Kunden ringes op om torsdagen';
                    }
                    field("Ringe Fredag"; Rec."Ringe Fredag")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Kunden ringes op om fredagen';
                    }
                }
                field("Ringetid"; Rec."Ringetid")
                {
                    ApplicationArea = All;
                    ToolTip = 'Foretrukken ringetid, f.eks. 08:30';
                }
            }

            // ── Kontaktpersoner ───────────────────────────────────────────────
            group(KontaktFaneblad)
            {
                Caption = 'Kontaktpersoner';

                group(Kontakt1Grp)
                {
                    Caption = 'Kontakt 1';
                    field("Kontakt1 Navn"; Rec."Kontakt1 Navn")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Navn på primær kontaktperson';
                    }
                    field("Kontakt1 Mobil"; Rec."Kontakt1 Mobil")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Mobilnummer — bruges til ring/SMS';
                    }
                    field("Kontakt1 Email"; Rec."Kontakt1 Email")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Email til primær kontakt';
                    }
                    field("Kontakt1 Portal Email"; Rec."Kontakt1 Portal Email")
                    {
                        ApplicationArea = All;
                        ToolTip = 'Email til portal-login (kan afvige fra kontaktemail)';
                    }
                }
                group(Kontakt2Grp)
                {
                    Caption = 'Kontakt 2';
                    field("Kontakt2 Navn"; Rec."Kontakt2 Navn") { ApplicationArea = All; }
                    field("Kontakt2 Mobil"; Rec."Kontakt2 Mobil") { ApplicationArea = All; }
                    field("Kontakt2 Email"; Rec."Kontakt2 Email") { ApplicationArea = All; }
                    field("Kontakt2 Portal Email"; Rec."Kontakt2 Portal Email") { ApplicationArea = All; }
                }
                group(Kontakt3Grp)
                {
                    Caption = 'Kontakt 3';
                    field("Kontakt3 Navn"; Rec."Kontakt3 Navn") { ApplicationArea = All; }
                    field("Kontakt3 Mobil"; Rec."Kontakt3 Mobil") { ApplicationArea = All; }
                    field("Kontakt3 Email"; Rec."Kontakt3 Email") { ApplicationArea = All; }
                    field("Kontakt3 Portal Email"; Rec."Kontakt3 Portal Email") { ApplicationArea = All; }
                }
            }

            // ── Portal status ─────────────────────────────────────────────────
            group(PortalFaneblad)
            {
                Caption = 'Portal';
                field("Portal Aktiv"; Rec."Portal Aktiv")
                {
                    ApplicationArea = All;
                    ToolTip = 'Er kunden oprettet og aktiv i bestillingsportalen?';
                }
                field("Portal Oprettet Dato"; Rec."Portal Oprettet Dato")
                {
                    ApplicationArea = All;
                    Editable = false;
                    ToolTip = 'Dato for portal-oprettelse';
                }
            }
        }
    }

    actions
    {
        addlast(processing)
        {
            action(SyncTilPortal)
            {
                ApplicationArea = All;
                Caption = 'Sync til Portal';
                ToolTip = 'Opretter eller opdaterer kunden i bestillingsportalen. Sender kontaktpersoner med som sub-brugere.';
                Image = Export;
                Promoted = true;
                PromotedCategory = Process;
                PromotedIsBig = true;

                trigger OnAction()
                var
                    SyncMgt: Codeunit "Venmark Portal Sync";
                begin
                    SyncMgt.SyncCustomer(Rec);
                end;
            }

            action(AabnPortal)
            {
                ApplicationArea = All;
                Caption = 'Åbn Portal';
                ToolTip = 'Åbner bestillingsportalen i browseren';
                Image = Web;

                trigger OnAction()
                begin
                    Hyperlink('https://din-portal-url.dk/portal/login');
                    // Udskift URL med jeres ngrok/produktions-URL
                end;
            }
        }
    }
}
