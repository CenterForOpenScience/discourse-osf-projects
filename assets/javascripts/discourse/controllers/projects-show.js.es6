/*jshint esversion: 6*/

// This file is based on discourse-tagging

import DiscoverySortableController from 'discourse/controllers/discovery-sortable';

var NavItem, extraNavItemProperties, customNavItemHref;

try {
    NavItem = require('discourse/models/nav-item').default;
    extraNavItemProperties = require('discourse/models/nav-item').extraNavItemProperties;
    customNavItemHref = require('discourse/models/nav-item').customNavItemHref;
} catch (e) {
    NavItem = Discourse.NavItem; // it's not a module in old Discourse code
}

// startsWith polyfill from https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/startsWith
if (!String.prototype.startsWith) {
    String.prototype.startsWith = function(searchString, position) {
        position = position || 0;
        return this.substr(position, searchString.length) === searchString;
    };
}

if (extraNavItemProperties) {
    extraNavItemProperties(function(text, opts) {
        var extraProps = {};
        if (opts && opts.projectGuid) {
            extraProps.projectGuid = opts.projectGuid;
        }
        if (opts && opts.viewOnly) {
            extraProps.viewOnly = opts.viewOnly;
        }
        return extraProps;
    });
}

if (customNavItemHref) {
    customNavItemHref(function(navItem) {
        if (navItem.get('projectGuid')) {
            var name = navItem.get('name');
            var path = '/forum/' + navItem.get('projectGuid') + '/';
            var category = navItem.get('category');
            var queryString = '';

            if (category) {
                path += 'c/';
                path += Discourse.Category.slugFor(category);
                if (navItem.get('noSubcategories')) {
                    path += '/none';
                }
                path += '/l/';
            }

            if (navItem.get('viewOnly')) {
                queryString = '?view_only=' + navItem.get('viewOnly');
            }

            return path + name.replace(' ', '-') + queryString;
        } else {
            return null;
        }
    });
}

export default DiscoverySortableController.extend({
    needs: ['application'],
    queryParams: ['view_only'],
    view_only: null,

    list: null,
    canCreateTopic: false,

    navItems: function() {
        var navList = NavItem.buildList(this.get('model.category'), {
            projectGuid: this.get('model.project_guid'),
            viewOnly: this.get('view_only'),
            filterMode: this.get('model.filter')
        });
        // Don't ever show the categories nav item.
        return navList.filter(function(navItem, i) {
            return !navItem.name.startsWith('categor');
        });
    }.property('model.category', 'model.guid', 'model.filter'),

    categories: function() {
        return Discourse.Category.list();
    }.property(),
});
