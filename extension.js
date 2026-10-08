'use strict';

import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const API_URL = 'https://currency.servicefather.ir/api/currencies/irt/usdt';
const REFRESH_INTERVAL_SECONDS = 30;

// Fonts put glyphs at different heights inside their line box, so shift the
// label until the visible glyphs (ink), not the line box, sit on the center
function centerInk(label) {
    const [ink, logical] = label.get_clutter_text().get_layout().get_pixel_extents();
    const offset = (ink.y + ink.height / 2) - (logical.y + logical.height / 2);
    label.translation_y = ink.height > 0 ? -Math.round(offset) : 0;
}

function newCenteredLabel(params) {
    const label = new St.Label({y_align: Clutter.ActorAlign.CENTER, ...params});
    // Re-measure once the theme font is applied
    label.connect_after('style-changed', () => centerInk(label));
    return label;
}

export default class UsdtTomanExtension extends Extension {
    enable() {
        this._session = new Soup.Session({timeout: 10});
        this._cancellable = new Gio.Cancellable();

        this._panelBox = new St.BoxLayout({
            style_class: 'panel-button',
            y_expand: true,
        });

        this._panelButtonText = newCenteredLabel({
            style_class: 'cPanelText',
            text: '1₮ = — T',
            style: 'line-height: 1; font-size: 14px;',
        });
        this._panelBox.add_child(this._panelButtonText);

        this._panelButtonIndicator = new St.Icon({
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        this._panelBox.add_child(this._panelButtonIndicator);

        this._panelButtonText.get_clutter_text().set_line_alignment(0);

        Main.panel._centerBox.insert_child_at_index(this._panelBox, 0);

        this._refresh();

        this._sourceId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            REFRESH_INTERVAL_SECONDS,
            () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    disable() {
        if (this._sourceId) {
            GLib.Source.remove(this._sourceId);
            this._sourceId = null;
        }

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._session) {
            this._session.abort();
            this._session = null;
        }

        this._panelButtonIndicator?.destroy();
        this._panelButtonIndicator = null;

        this._panelButtonText?.destroy();
        this._panelButtonText = null;

        if (this._panelBox) {
            this._panelBox.get_parent()?.remove_child(this._panelBox);
            this._panelBox.destroy();
            this._panelBox = null;
        }
    }

    async _refresh() {
        try {
            const message = Soup.Message.new('GET', API_URL);

            const bytes = await this._session.send_and_read_async(
                message,
                GLib.PRIORITY_DEFAULT,
                this._cancellable
            );

            // The extension may have been disabled while the request was in flight
            if (!this._panelButtonText)
                return;

            if (message.get_status() !== Soup.Status.OK)
                throw new Error(`HTTP ${message.get_status()}`);

            const response = new TextDecoder().decode(bytes.get_data());
            const tether = JSON.parse(response)?.data ?? {};

            const price = parseInt(tether.rate ?? 0);
            const displayValue = price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            this._panelButtonText.text = `1₮ = ${displayValue}T`;

            const diff = parseFloat(tether.diff ?? 0);
            const isPriceIncreased = diff === 0 ? null : diff > 0;

            this._panelButtonIndicator.visible = isPriceIncreased !== null;
            if (isPriceIncreased !== null) {
                this._panelButtonIndicator.icon_name = isPriceIncreased
                    ? 'go-up-symbolic' : 'go-down-symbolic';
                this._panelButtonIndicator.style_class = isPriceIncreased
                    ? 'priceIncrease' : 'priceDecrease';
            }

            centerInk(this._panelButtonText);
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            console.error(`USDT-Toman: ${error}`);

            if (this._panelButtonText) {
                this._panelButtonText.text = '1₮ = — T';
                this._panelButtonIndicator.visible = false;
                centerInk(this._panelButtonText);
            }
        }
    }
}
