/// <summary>
/// FactBox der viser kontaktpersoner og portal-info i højre side af Kontaktboardet.
/// </summary>
page 50311 "Venmark Kontakt FactBox"
{
    ApplicationArea = All;
    Caption = 'Kontaktpersoner';
    PageType = CardPart;
    SourceTable = Customer;
    Editable = false;

    layout
    {
        area(content)
        {
            group(K1)
            {
                Caption = 'Kontakt 1';
                Visible = Rec."Kontakt1 Navn" <> '';

                field("Kontakt1 Navn"; Rec."Kontakt1 Navn") { ApplicationArea = All; ShowCaption = false; Style = Strong; }
                field(K1Mobil; Rec."Kontakt1 Mobil")
                {
                    ApplicationArea = All;
                    Caption = 'Mobil';

                    trigger OnDrillDown()
                    begin
                        RingMobil(Rec."Kontakt1 Mobil");
                    end;
                }
                field(K1Email; Rec."Kontakt1 Email")
                {
                    ApplicationArea = All;
                    Caption = 'Email';

                    trigger OnDrillDown()
                    begin
                        if Rec."Kontakt1 Email" <> '' then
                            Hyperlink('mailto:' + Rec."Kontakt1 Email");
                    end;
                }
            }

            group(K2)
            {
                Caption = 'Kontakt 2';
                Visible = Rec."Kontakt2 Navn" <> '';

                field("Kontakt2 Navn"; Rec."Kontakt2 Navn") { ApplicationArea = All; ShowCaption = false; Style = Strong; }
                field(K2Mobil; Rec."Kontakt2 Mobil")
                {
                    ApplicationArea = All;
                    Caption = 'Mobil';

                    trigger OnDrillDown()
                    begin
                        RingMobil(Rec."Kontakt2 Mobil");
                    end;
                }
                field("Kontakt2 Email"; Rec."Kontakt2 Email") { ApplicationArea = All; Caption = 'Email'; }
            }

            group(K3)
            {
                Caption = 'Kontakt 3';
                Visible = Rec."Kontakt3 Navn" <> '';

                field("Kontakt3 Navn"; Rec."Kontakt3 Navn") { ApplicationArea = All; ShowCaption = false; Style = Strong; }
                field(K3Mobil; Rec."Kontakt3 Mobil")
                {
                    ApplicationArea = All;
                    Caption = 'Mobil';

                    trigger OnDrillDown()
                    begin
                        RingMobil(Rec."Kontakt3 Mobil");
                    end;
                }
                field("Kontakt3 Email"; Rec."Kontakt3 Email") { ApplicationArea = All; Caption = 'Email'; }
            }

            group(PortalGrp)
            {
                Caption = 'Portal';

                field("Portal Aktiv"; Rec."Portal Aktiv") { ApplicationArea = All; Caption = 'Portal aktiv'; }
                field("Portal Oprettet Dato"; Rec."Portal Oprettet Dato") { ApplicationArea = All; Caption = 'Oprettet'; }
            }
        }
    }

    local procedure RingMobil(Mobil: Text)
    begin
        if Mobil = '' then exit;
        Mobil := Mobil.Replace(' ', '').Replace('-', '');
        if not Mobil.StartsWith('+') then
            Mobil := '+45' + Mobil;
        Hyperlink('tel:' + Mobil);
    end;
}
