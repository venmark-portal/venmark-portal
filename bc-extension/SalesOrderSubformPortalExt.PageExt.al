pageextension 50100 "Sales Order Subform Portal Ext" extends "Sales Order Subform"
{
    layout
    {
        addafter(Quantity)
        {
            field("Portal Line Status"; Rec."Portal Line Status")
            {
                ApplicationArea = All;
                Caption = 'Portal Line Status';
                StyleExpr = PortalLineStatusStyle;
            }
            field("Portal Kundebemærkning"; Rec."Portal Kundebemærkning")
            {
                ApplicationArea = All;
                Caption = 'Kundebemærkning (portal)';
            }
        }
    }

    var
        PortalLineStatusStyle: Text;

    trigger OnAfterGetRecord()
    begin
        case Rec."Portal Line Status" of
            Rec."Portal Line Status"::Godkendt:
                PortalLineStatusStyle := 'Favorable';
            Rec."Portal Line Status"::Afvist:
                PortalLineStatusStyle := 'Unfavorable';
            Rec."Portal Line Status"::Afventer:
                PortalLineStatusStyle := 'Ambiguous';
            else
                PortalLineStatusStyle := '';
        end;
    end;
}
