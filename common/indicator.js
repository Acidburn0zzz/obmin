/*
 * Obmin - Simple File Sharing Server For GNU/Linux Desktop
 *
 * Copyright (C) 2017 Kostiantyn Korienkov <kapa76@gmail.com>
 *
 * This file is part of Obmin File Server.
 *
 * Obmin is free software: you can redistribute it and/or modify it
 * under the terms of the GNU General Public License as published by the
 * Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Obmin is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
 * See the GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License along
 * with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

const Gtk = imports.gi.Gtk;
const Gdk = imports.gi.Gdk;
const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const AI = imports.gi.AppIndicator3;
const Lang = imports.lang;

const APPDIR = get_appdir ();
imports.searchPath.unshift(APPDIR);

const Gettext = imports.gettext.domain('gnome-shell-extensions-obmin');
const _ = Gettext.gettext;
const Convenience = imports.convenience;

//const Clipboard = Gtk.Clipboard.get_default(Gdk.Display.get_default());

const DEBUG_KEY = 'debug';
const STARTUP_KEY = 'startup-settings';
const STATS_MONITOR_KEY = 'stats-monitor';
const STATS_DATA_KEY = 'stats';
const SUPPORT_KEY = 'support';
const PORT_KEY = 'port';
const STATUS_KEY = 'status';

let startup = false;
let support = 0;
let port = 8088;
let DEBUG = 1;
let status = 30;
let stats_monitor = true;
let stats = {access:0, ready:0, upload:0};

let status_event = 0;
let update_event = 0;
let settings = null;
let server = 0;
let desktop = '';

var ObminIndicator = new Lang.Class ({
    Name: 'ObminIndicator',

    _init: function () {
        DEBUG = settings.get_int (DEBUG_KEY);
        startup = settings.get_boolean (STARTUP_KEY);
        support = settings.get_int (SUPPORT_KEY);
        port = settings.get_int (PORT_KEY);
        status = settings.get_int (STATUS_KEY);
        stats_monitor = settings.get_boolean (STATS_MONITOR_KEY);
        desktop = GLib.getenv ("XDG_CURRENT_DESKTOP").toUpperCase ();

        this.application = new Gtk.Application ({
            application_id: "org.konkor.obmin.indicator",
            flags: Gio.ApplicationFlags.HANDLES_OPEN});
        GLib.set_application_name ("OBMIN Indicator");
        GLib.set_prgname ("OBMIN Indicator");
        this.application.connect ('activate', Lang.bind (this, this._onActivate));
        this.application.connect ('startup', Lang.bind (this, this._onStartup));
        debug (desktop);
    },

    _onActivate: function (){
        this._window.hide ();
    },

    _onStartup: function () {
        this._window = new Gtk.Window ();
        this._window.title = "OBMIN Indicator";
        this._window.set_icon_name ('obmin');
        if (!this._window.icon) try {
            this._window.icon = Gtk.Image.new_from_file (APPDIR + "/data/icons/obmin.svg").pixbuf;
        } catch (e) {
            error (e.message);
        }
        this.application.add_window (this._window);
        server = this.server_enabled;
        this.build_menu ();
        if (server) {
            stats = JSON.parse (settings.get_string (STATS_DATA_KEY));
            this.update_stats ();
        } else if (startup) this._enable (true);
        if (status > 0) status_event = GLib.timeout_add_seconds (0, status, Lang.bind (this, function () {
            this.check_status ();
            return true;
        }));
        if (stats_monitor)
            settings.connect ("changed::" + STATS_DATA_KEY, Lang.bind (this, function() {
            stats = JSON.parse (settings.get_string (STATS_DATA_KEY));
            if (update_event) GLib.Source.remove (update_event);
            update_event = GLib.timeout_add (0, 50, Lang.bind (this, this.update_stats ));
        }));
    },

    check_status: function () {
        let run = false;
        let res = GLib.spawn_command_line_sync ("ps -A");
        let o, n;
        if (res[0]) o = res[1].toString().split("\n");
        res = null;
        for (let i = 0; i < o.length; i++) {
            if (o[i].indexOf ("obmin-server") > -1) {
                n = parseInt (o[i].trim().split(" ")[0]);
                if (Number.isInteger(n) && n > 0) run = n;
                break;
            }
        }
        debug ("status: " + run?"":"Stopped");
        if (run != server) {
            server = run;
            this.lock = true;
            this.server_switch.set_active (server);
            this.lock = false;
            this.update_icon ();
        }
    },

    update_icon: function () {
        if (!server) this.indicator.set_icon ("obmin-off");
        else if ((stats.access - stats.ready) > 0) {
            if (this.indicator.get_icon() != "obmin-run") this.indicator.set_icon ("obmin-run");
        } else if (this.indicator.get_icon() != "obmin-on") this.indicator.set_icon ("obmin-on");
    },

    update_stats: function () {
        if (update_event) {
            GLib.Source.remove (update_event);
            update_event = 0;
        }
        if (stats.access && (stats.access >= 0)) {
            this.connections.update ((stats.access - stats.ready).toString());
            this.requests.update (stats.access.toString());
            this.uploads.update (GLib.format_size (stats.upload));
        }
        if (server) this.update_icon ();
        else this.indicator.set_icon ("obmin-off");
        return false;
    },

    build_menu: function () {
        var item;
        this.appmenu = new Gtk.Menu ();
        this.indicator = AI.Indicator.new ("Obmin", "obmin-indicator", AI.IndicatorCategory.APPLICATION_STATUS);
        this.indicator.set_icon_theme_path (APPDIR + "/data/icons");
        this.server_switch = Gtk.CheckMenuItem.new_with_label (" ");
        this.server_switch.get_child().set_markup ("<b> Obmin "+_("Server")+"</b>");
        this.server_switch.tooltip_text = _("Activate Obmin Server");
        this.server_switch.active = server;
        this.server_switch.connect ('toggled', Lang.bind (this, function () {
            if (!this.lock) this._enable (this.server_switch.active);
        }));
        this.appmenu.append (this.server_switch);
        this.appmenu.append (new Gtk.SeparatorMenuItem ());

        this.info_local = new LocalItem ();
        this.appmenu.append (this.info_local);
        this.info_public = new PublicItem ();
        this.appmenu.append (this.info_public);

        this.stats = Gtk.MenuItem.new_with_label (" ");
        this.stats.get_child().set_markup ("<b>"+_("Usage Statistics")+"</b>");
        this.appmenu.senitive = false;

        this.connections = new InfoMenuItem (_("Active"), "0");
        this.connections.tooltip_text = _("Active connections");
        this.requests = new InfoMenuItem (_("Total Requests"), "0");
        this.requests.tooltip_text = _("Total Number Of Requests To Obmin Server");
        this.uploads = new InfoMenuItem (_("Transferred"), "0 bytes");
        this.uploads.tooltip_text = _("Total Amount Of The Transferred Data From Obmin Server");
        if (desktop != "PANTHEON") {
        this.appmenu.append (new Gtk.SeparatorMenuItem ());
        this.appmenu.append (this.stats);
        this.appmenu.append (this.connections);
        this.appmenu.append (this.requests);
        this.appmenu.append (this.uploads);
        this.connections.connect ('activate', Lang.bind (this, function () {
            GLib.spawn_command_line_async (APPDIR + '/obmin-center');
        }));
        this.requests.connect ('activate', Lang.bind (this, function () {
            GLib.spawn_command_line_async (APPDIR + '/obmin-center');
        }));
        this.uploads.connect ('activate', Lang.bind (this, function () {
            GLib.spawn_command_line_async (APPDIR + '/obmin-center');
        }));
        }

        this.appmenu.append (new Gtk.SeparatorMenuItem ());
        item = Gtk.MenuItem.new_with_label (_("Control Center..."));
        item.tooltip_text = _("Open Obmin Control Center");
        item.connect ('activate', Lang.bind (this, function () {
            GLib.spawn_command_line_async (APPDIR + '/obmin-center');
        }));
        this.appmenu.append (item);

        this.appmenu.append (new Gtk.SeparatorMenuItem ());
        item = Gtk.MenuItem.new_with_label (_("Exit"));
        item.connect ('activate', Lang.bind (this, function () {
            this.remove_events ();
            this.application.quit ();
        }));
        this.appmenu.append (item);

        this.appmenu.show_all ();
        this.indicator.set_status (AI.IndicatorStatus.ACTIVE);
        this.indicator.set_icon ("obmin-off");
        this.indicator.set_menu (this.appmenu);
        this.appmenu.connect ('show', Lang.bind (this, function () {
            this.check_status ();
            port = settings.get_int (PORT_KEY);
            this.info_local.update ();
            this.info_public.update ();
            this.update_stats ();
        }));
    },

    _enable: function (state) {
        server = state;
        if (state) {
            if (GLib.spawn_command_line_async (APPDIR + "/obmin-server")) {
                this.indicator.set_icon ("obmin-on");
            } else {
                server = false;
                this.indicator.set_icon ("obmin-off");
                this.server_switch.setToggleState (false);
            }
        } else {
            GLib.spawn_command_line_async ("killall obmin-server");
            this.indicator.set_icon ("obmin-off");
        }
        if (this.server_switch.get_active() != server) {
            this.lock = true;
            this.server_switch.set_active (server);
            this.lock = false;
        }
    },

    get server_enabled () {
        let res = GLib.spawn_command_line_sync ("ps -A");
        let o, n;
        if (res[0]) o = res[1].toString().split("\n");
        for (let i = 0; i < o.length; i++) {
            if (o[i].indexOf ("obmin-server") > -1) {
                n = parseInt (o[i].trim().split(" ")[0]);
                if (Number.isInteger(n) && n > 0) return n;
            }
        }
        return false;
    },

    remove_events: function () {
        if (status_event) GLib.Source.remove (status_event);
        status_event = 0;
        if (update_event) GLib.Source.remove (update_event);
        update_event = 0;
    }
});

const LocalItem = new Lang.Class ({
    Name: 'LocalItem',
    Extends: Gtk.MenuItem,

    _init: function () {
        this.prefix = "<b>" + _("Local IP") + "</b> ";
        this.parent ({label:this.prefix + this.ip});
        this.tooltip_text = _("Local Network IP Address");
    },

    get ip () {
        let l = get_info_string ("hostname -I").split (" ");
        if (l[0]) if (l[0].length > 6) return l[0] + ":" + port;
        return "127.0.0.1:" + port;
    },

    update: function () {
        //this.set_label (this.prefix + this.ip);
        this.get_child().set_markup (this.prefix + this.ip);
    }
});

const PublicItem = new Lang.Class ({
    Name: 'PublicItem',
    Extends: Gtk.MenuItem,

    _init: function () {
        this.prefix = "<b>" + _("Public IP") + "</b> ";
        this.parent ({label:this.prefix});
        this.tooltip_text = _("External Network IP Address");
        this._ip = "";
    },

    update: function () {
        Convenience.fetch ("http://ipecho.net/plain", null, null, Lang.bind (this, (text, s) => {
            if ((s == 200) && text) {
                this._ip = text.split("\n")[0];
                if (!this._ip || this._ip.length < 7) this._ip = "";
            } else this._ip = "";
            if (this._ip) this.visible = true;
            else this.visible = false;
            this.get_child().set_markup (this.prefix + this._ip);
            return false;
        }));
    }
});

const InfoMenuItem = new Lang.Class ({
    Name: 'InfoMenuItem',
    Extends: Gtk.MenuItem,

    _init: function (desc, val) {
        this.prefix = "<b>" + desc + "</b>  ";
        this.parent ({label:desc});
    },

    update: function (text) {
        this.get_child().set_markup (this.prefix + text);
    }
});

function getCurrentFile () {
    let stack = (new Error()).stack;
    let stackLine = stack.split('\n')[1];
    if (!stackLine)
        throw new Error ('Could not find current file');
    let match = new RegExp ('@(.+):\\d+').exec(stackLine);
    if (!match)
        throw new Error ('Could not find current file');
    let path = match[1];
    let file = Gio.File.new_for_path (path).get_parent();
    return [file.get_path(), file.get_parent().get_path(), file.get_basename()];
}

function get_appdir () {
    let s = getCurrentFile ()[1];
    if (GLib.file_test (s + "/prefs.js", GLib.FileTest.EXISTS)) return s;
    s = GLib.get_home_dir () + "/.local/share/gnome-shell/extensions/obmin@konkor";
    if (GLib.file_test (s + "/prefs.js", GLib.FileTest.EXISTS)) return s;
    s = "/usr/share/gnome-shell/extensions/obmin@konkor";
    if (GLib.file_test (s + "/prefs.js", GLib.FileTest.EXISTS)) return s;
    throw "Obmin installation not found...";
    return s;
}

let cmd_out, info_out;
function get_info_string (cmd) {
    cmd_out = GLib.spawn_command_line_sync (cmd);
    if (cmd_out[0]) info_out = cmd_out[1].toString().split("\n")[0];
    if (info_out) return info_out;
    return "";
}

function debug (msg) {
    if (msg && (DEBUG > 1)) print ("[obmin][indicator] " + msg);
}

function error (msg) {
    log ("[obmin][indicator] (EE) " + msg);
}

Convenience.initTranslations ();

settings = Convenience.getSettings ();

let app = new ObminIndicator ();
app.application.run (ARGV);
