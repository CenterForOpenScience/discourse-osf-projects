/*jshint esversion: 6*/

// This file is highly based on discourse-tagging

import DiscoverySortableController from 'discourse/controllers/discovery-sortable';

var NavItem, extraNavItemProperties, customNavItemHref;

try {
    NavItem = require('discourse/models/nav-item').default;
    extraNavItemProperties = require('discourse/models/nav-item').extraNavItemProperties;
    customNavItemHref = require('discourse/models/nav-item').customNavItemHref;
} catch (e) {
    NavItem = Discourse.NavItem; // it's not a module in old Discourse code
}

if (extraNavItemProperties) {
    extraNavItemProperties(function(text, opts) {
        if (opts && opts.projectGuid) {
            return { projectGuid: opts.projectGuid };
        } else {
            return {};
        }
    });
}

if (customNavItemHref) {
    customNavItemHref(function(navItem) {
        if (navItem.get('projectGuid')) {
            var name = navItem.get('name');
            var path = '/forum/' + navItem.get('projectGuid') + '/';
            var category = navItem.get('category');

            if (category) {
                path += 'c/';
                path += Discourse.Category.slugFor(category);
                if (navItem.get('noSubcategories')) {
                    path += '/none';
                }
                path += '/l/';
            }
            return path + name.replace(' ', '-');
        } else {
            return null;
        }
    });
}

export default DiscoverySortableController.extend({
    needs: ['application'],

    list: null,
    canCreateTopic: false,

    navItems: function() {
        var navList = NavItem.buildList(this.get('model.category'), {
            projectGuid: this.get('model.guid'),
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
