'use strict';

import St from 'gi://St';
import Gio from 'gi://Gio';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const API_URL = 'https://api.tetherland.com/currencies';
const REFRESH_INTERVAL_SECONDS = 30;

export default class UsdtTomanExtension extends Extension {
    enable() {
        this._session = new Soup.Session({timeout: 10});
        this._cancellable = new Gio.Cancellable();

        this._panelBox = new St.BoxLayout({
            style_class: 'panel-button',
            y_expand: true,
        });

        this._panelButtonText = new St.Label({
            style_class: 'cPanelText',
            text: '1₮ = — T',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'line-height: 1; font-size: 14px;',
        });
        this._panelBox.add_child(this._panelButtonText);

        this._panelButtonIndicator = new St.Label({
            text: '',
            y_align: Clutter.ActorAlign.CENTER,
            style: 'line-height: 1; font-size: 12px;',
        });
        this._panelBox.add_child(this._panelButtonIndicator);

        this._panelButtonText.get_clutter_text().set_line_alignment(0);
        this._panelButtonIndicator.get_clutter_text().set_line_alignment(0);

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
            const tether = JSON.parse(response)?.data?.currencies?.USDT ?? {};

            const price = parseInt(tether.price ?? 0);
            const displayValue = price.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
            this._panelButtonText.text = `1₮ = ${displayValue}T`;

            const diff = parseFloat(tether.diff24d ?? 0);
            const isPriceIncreased = diff === 0 ? null : diff > 0;

            this._panelButtonIndicator.text = isPriceIncreased === null
                ? '' : (isPriceIncreased ? '🡱' : '🡳');
            this._panelButtonIndicator.style_class = isPriceIncreased
                ? 'priceIncrease' : 'priceDecrease';
        } catch (error) {
            if (error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                return;

            console.error(`USDT-Toman: ${error}`);

            if (this._panelButtonText) {
                this._panelButtonText.text = '1₮ = — T';
                this._panelButtonIndicator.text = '';
            }
        }
    }
}
